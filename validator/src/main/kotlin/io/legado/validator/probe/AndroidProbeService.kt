package io.legado.validator.probe

import com.google.gson.Gson
import io.legado.validator.help.http.HttpHelper
import java.io.File

data class ProbeDevice(
    val serial: String,
    val state: String
)

data class ProbeRenderRequest(
    val url: String,
    val headers: Map<String, String> = emptyMap(),
    val javaScript: String? = null,
    val timeout: Long = 60000L,
    val jsRetries: Int = 30,
    val jsDelay: Long = 1000L,
    val screenshot: Boolean = true
)

data class ProbeRenderResponse(
    val ok: Boolean,
    val html: String? = null,
    val finalUrl: String? = null,
    val title: String? = null,
    val cookies: String? = null,
    val screenshotBase64: String? = null,
    val error: String? = null,
    val jsError: String? = null,
    val loadTimeMs: Long = 0
)

data class ProbeInfo(
    val available: Boolean,
    val device: ProbeDevice? = null,
    val probeVersion: String? = null,
    val webViewVersion: String? = null,
    val error: String? = null
)

object AndroidProbeService {
    private val gson = Gson()
    private const val PROBE_PORT = 18888
    private const val LOCAL_PORT = 18888

    fun findAdb(): String? {
        val androidHome = System.getenv("ANDROID_HOME") ?: System.getenv("ANDROID_SDK_ROOT")
        if (androidHome != null) {
            val adb = File(androidHome, "platform-tools/adb.exe")
            if (adb.exists()) return adb.absolutePath
            val adbUnix = File(androidHome, "platform-tools/adb")
            if (adbUnix.exists()) return adbUnix.absolutePath
        }
        return try {
            val p = ProcessBuilder("adb", "version").start()
            p.waitFor()
            if (p.exitValue() == 0) "adb" else null
        } catch (_: Exception) { null }
    }

    fun listDevices(adbPath: String? = findAdb()): List<ProbeDevice> {
        val adb = adbPath ?: return emptyList()
        return try {
            val p = ProcessBuilder(adb, "devices").start()
            val output = p.inputStream.bufferedReader().readText()
            p.waitFor()
            output.lines().drop(1).mapNotNull { line ->
                val parts = line.trim().split("\\s+".toRegex())
                if (parts.size >= 2) ProbeDevice(parts[0], parts[1]) else null
            }.filter { it.state == "device" }
        } catch (_: Exception) { emptyList() }
    }

    fun setupForward(adbPath: String, serial: String): Boolean {
        return try {
            val p = ProcessBuilder(adbPath, "-s", serial, "forward", "tcp:$LOCAL_PORT", "tcp:$PROBE_PORT").start()
            p.waitFor()
            p.exitValue() == 0
        } catch (_: Exception) { false }
    }

    fun ping(): Boolean {
        return try {
            val res = HttpHelper.get("http://127.0.0.1:$LOCAL_PORT/ping")
            res.body == "pong"
        } catch (_: Exception) { false }
    }

    fun info(): Map<String, Any?>? {
        return try {
            val res = HttpHelper.get("http://127.0.0.1:$LOCAL_PORT/info")
            @Suppress("UNCHECKED_CAST")
            gson.fromJson(res.body, Map::class.java) as? Map<String, Any?>
        } catch (_: Exception) { null }
    }

    fun render(request: ProbeRenderRequest): ProbeRenderResponse {
        return try {
            val json = gson.toJson(request)
            val res = HttpHelper.post(
                "http://127.0.0.1:$LOCAL_PORT/render",
                json,
                headers = mapOf("Content-Type" to "application/json")
            )
            gson.fromJson(res.body, ProbeRenderResponse::class.java)
        } catch (e: Exception) {
            ProbeRenderResponse(ok = false, error = "Probe request failed: ${e.message}")
        }
    }

    fun installApk(adbPath: String, serial: String, apkPath: String): Boolean {
        return try {
            val p = ProcessBuilder(adbPath, "-s", serial, "install", "-r", apkPath).start()
            val output = p.inputStream.bufferedReader().readText()
            p.waitFor()
            p.exitValue() == 0 && output.contains("Success")
        } catch (_: Exception) { false }
    }

    fun startProbe(adbPath: String, serial: String): Boolean {
        return try {
            val p = ProcessBuilder(adbPath, "-s", serial, "shell", "am", "start",
                "-n", "io.legado.probe/.WebViewProbeActivity").start()
            p.waitFor()
            p.exitValue() == 0
        } catch (_: Exception) { false }
    }

    fun findApk(): String? {
        val candidates = listOf(
            "android-probe.apk",  // release package location
            "android-probe/app/build/outputs/apk/debug/app-debug.apk",
            "../android-probe/app/build/outputs/apk/debug/app-debug.apk",
            "probe.apk"
        )
        for (c in candidates) {
            val f = File(c)
            if (f.exists()) return f.absolutePath
        }
        return null
    }

    fun probeCheck(autoInstall: Boolean = true): ProbeInfo {
        val adb = findAdb() ?: return ProbeInfo(available = false, error = "adb not found")
        val devices = listDevices(adb)
        if (devices.isEmpty()) return ProbeInfo(available = false, error = "No Android devices connected")
        val device = devices.first()
        if (!setupForward(adb, device.serial)) return ProbeInfo(available = false, device = device, error = "adb forward failed")
        if (!ping()) {
            if (autoInstall) {
                val apk = findApk()
                if (apk != null) {
                    installApk(adb, device.serial, apk)
                    startProbe(adb, device.serial)
                    Thread.sleep(2000) // wait for server startup
                    if (ping()) {
                        val probeInfo = info()
                        return ProbeInfo(available = true, device = device,
                            probeVersion = probeInfo?.get("version")?.toString(),
                            webViewVersion = probeInfo?.get("webViewVersion")?.toString())
                    }
                }
            }
            return ProbeInfo(available = false, device = device, error = "Probe not responding on port $LOCAL_PORT")
        }
        val probeInfo = info()
        return ProbeInfo(
            available = true,
            device = device,
            probeVersion = probeInfo?.get("version")?.toString(),
            webViewVersion = probeInfo?.get("webViewVersion")?.toString()
        )
    }
}
