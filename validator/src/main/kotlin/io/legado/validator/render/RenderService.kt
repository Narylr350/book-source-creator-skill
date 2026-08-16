package io.legado.validator.render

import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

data class RenderResult(
    val ok: Boolean,
    @SerializedName("finalUrl") val finalUrl: String? = null,
    val title: String? = null,
    val html: String? = null,
    val screenshot: String? = null,
    val bodyLength: Int = 0,
    val httpCode: Int? = null,
    val needsAppReview: Boolean = false,
    val reviewReason: String? = null,
    val error: String? = null
)

object RenderService {
    private val gson = Gson()

    suspend fun render(
        url: String,
        timeout: Int = 30000,
        searchKeyword: String? = null,
        searchUrlTemplate: String? = null
    ): RenderResult = withContext(Dispatchers.IO) {
        try {
            val scriptPath = findRenderScript()
                ?: return@withContext RenderResult(ok = false, error = "render_helper.py not found")

            val params = mutableMapOf<String, Any>("url" to url, "timeout" to timeout)
            if (searchKeyword != null) {
                params["searchKeyword"] = searchKeyword
                params["searchUrlTemplate"] = searchUrlTemplate ?: url
            }
            val request = gson.toJson(params)

            val scriptFile = File(scriptPath)
            if (!scriptFile.isFile || !scriptPath.endsWith(".py")) {
                return@withContext RenderResult(ok = false, error = "Invalid render script path")
            }

            val process = ProcessBuilder("python", scriptFile.canonicalPath)
                .redirectErrorStream(false)
                .redirectError(File.createTempFile("render_err", ".log").apply { deleteOnExit() })
                .apply {
                    environment()["PYTHONIOENCODING"] = "utf-8"
                    environment()["PYTHONUTF8"] = "1"
                }
                .start()

            // 写入请求
            process.outputStream.write(request.toByteArray(Charsets.UTF_8))
            process.outputStream.flush()
            process.outputStream.close()

            // 读取 stdout
            val stdout = process.inputStream.bufferedReader(Charsets.UTF_8).readText()
            val exitCode = process.waitFor()

            if (exitCode != 0) {
                return@withContext RenderResult(
                    ok = false,
                    error = "render_helper.py exited with code $exitCode"
                )
            }

            gson.fromJson(stdout, RenderResult::class.java)
        } catch (e: Exception) {
            RenderResult(ok = false, error = "${e::class.simpleName}: ${e.message}")
        }
    }

    private fun findRenderScript(): String? {
        val stream = RenderService::class.java.getResourceAsStream("/render_helper.py")
        if (stream != null) {
            val tmp = File.createTempFile("render_helper", ".py")
            tmp.deleteOnExit()
            tmp.writeBytes(stream.readBytes())
            return tmp.absolutePath
        }
        val candidates = listOf(
            File("src/main/resources/render_helper.py"),
            File("render_helper.py")
        )
        for (c in candidates) {
            if (c.exists()) return c.absolutePath
        }
        return null
    }
}
