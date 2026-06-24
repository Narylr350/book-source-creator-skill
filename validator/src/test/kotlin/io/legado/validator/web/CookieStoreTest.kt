package io.legado.validator.web

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class CookieStoreTest {

    @BeforeEach
    fun reset() {
        CookieStore.clearAll()
    }

    @Test
    fun `www and wap subdomains share one cookie via eTLD+1 normalization`() {
        // 站点把登录态设在 wap. 子域，书源请求 base 域 www.。
        // 归一后两者都落到 ciweimao.com 同一 key，base 域请求能取到子域登录 cookie。
        CookieStore.setCookie("wap.ciweimao.com", "user_id=1; login_token=abc")
        assertEquals("user_id=1; login_token=abc", CookieStore.getCookie("www.ciweimao.com"))
        assertEquals("user_id=1; login_token=abc", CookieStore.getCookie("wap.ciweimao.com"))
        assertEquals("user_id=1; login_token=abc", CookieStore.getCookie("ciweimao.com"))
    }

    @Test
    fun `bare host and full url normalize identically`() {
        CookieStore.setCookie("https://www.example.com/login", "session=xyz")
        assertEquals("session=xyz", CookieStore.getCookie("www.example.com"))
        assertEquals("session=xyz", CookieStore.getCookie("https://wap.example.com/path"))
    }

    @Test
    fun `m subdomain also normalizes to base`() {
        CookieStore.setCookie("m.example.com", "a=1")
        assertEquals("a=1", CookieStore.getCookie("www.example.com"))
    }

    @Test
    fun `different eTLD+1 stay separate`() {
        CookieStore.setCookie("www.ciweimao.com", "a=1")
        CookieStore.setCookie("www.example.com", "b=2")
        assertEquals("a=1", CookieStore.getCookie("wap.ciweimao.com"))
        assertEquals("b=2", CookieStore.getCookie("wap.example.com"))
    }

    @Test
    fun `clearCookie clears the whole site across subdomains`() {
        CookieStore.setCookie("wap.ciweimao.com", "a=1")
        CookieStore.clearCookie("www.ciweimao.com")
        assertNull(CookieStore.getCookie("wap.ciweimao.com"))
    }
}
