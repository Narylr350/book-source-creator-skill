package io.legado.validator.help.http

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class HttpHelperTest {
    private val utf8Body = """<html><head><meta charset="utf-8"></head><body>刺猬猫</body></html>"""

    @Test
    fun `lowercase utf8 meta keeps decoded response body`() {
        assertEquals(utf8Body, HttpHelper.decodeBody(utf8Body, null))
    }

    @Test
    fun `explicit lowercase utf8 keeps decoded response body`() {
        assertEquals(utf8Body, HttpHelper.decodeBody(utf8Body, "utf-8"))
    }
}
