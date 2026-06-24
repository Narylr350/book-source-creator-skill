package io.legado.validator.web

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import okhttp3.internal.publicsuffix.PublicSuffixDatabase
import java.io.File
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

object CookieStore {
    private val cookies = ConcurrentHashMap<String, String>()
    private val gson = Gson()
    private val persistFile: File by lazy {
        val envPath = System.getenv("COOKIE_STORE")
        if (envPath != null) File(envPath)
        else File("validator-cookies.json")
    }

    init {
        loadFromDisk()
    }

    fun setCookie(domain: String, cookie: String) {
        cookies[normalizeDomain(domain)] = cookie
        saveToDisk()
    }

    fun getCookie(domain: String): String? = cookies[normalizeDomain(domain)]

    fun clearCookie(domain: String) {
        cookies.remove(normalizeDomain(domain))
        saveToDisk()
    }

    fun clearAll() {
        cookies.clear()
        saveToDisk()
    }

    fun getAll(): Map<String, String> = cookies.toMap()

    fun hasCookies(): Boolean = cookies.isNotEmpty()

    private fun saveToDisk() {
        try {
            persistFile.writeText(gson.toJson(cookies.toMap()))
        } catch (_: Exception) {
            // 静默失败 — Cookie 持久化不是关键路径，文件写入失败不影响验证
        }
    }

    private fun loadFromDisk() {
        try {
            if (persistFile.exists()) {
                val json = persistFile.readText()
                val map: Map<String, String> = gson.fromJson(
                    json,
                    object : TypeToken<Map<String, String>>() {}.type
                )
                // 归一旧键，兼容归一逻辑引入前的持久化文件
                map.forEach { (k, v) -> cookies[normalizeDomain(k)] = v }
            }
        } catch (_: Exception) {
            // 文件损坏或不可读时清空启动
            cookies.clear()
        }
    }

    // 归一到 eTLD+1（与阅读 NetworkUtils.getSubDomain 一致）：
    // www.ciweimao.com / wap.ciweimao.com / m.ciweimao.com 都归一到 ciweimao.com，
    // 使同站不同子域的 cookie 共享同一 key。站点常把登录态设在子域(wap./m.)，
    // 而书源请求 base 域(www.)；不归一会导致 base 域请求查不到子域登录 cookie。
    private fun normalizeDomain(domain: String): String {
        if (domain.isBlank()) return domain.lowercase()
        val raw = domain.trim().lowercase()
        // 接受裸域(www.ciweimao.com)或完整 URL(https://www.ciweimao.com/path)
        val host = runCatching {
            URL(if (raw.contains("://")) raw else "https://$raw").host
        }.getOrDefault(raw)
        if (host.isBlank() || host == raw && !raw.contains(".")) return raw
        return PublicSuffixDatabase.get().getEffectiveTldPlusOne(host) ?: host
    }
}
