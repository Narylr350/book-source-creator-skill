package io.legado.probe

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProbeCookieSummaryTest {
    @Test
    fun anonymousCookieDoesNotCountAsLoginEvidence() {
        val summary = summarizeCookies("ci_session=abc; readPage_visits=2")

        assertEquals(listOf("ci_session", "readPage_visits"), summary.cookieNames)
        assertFalse(summary.hasLoginEvidence)
    }

    @Test
    fun loginCookieNamesCountAsLoginEvidence() {
        val summary = summarizeCookies("user_id=1; reader_id=1; login_token=abc; ci_session=def")

        assertEquals(listOf("user_id", "reader_id", "login_token", "ci_session"), summary.cookieNames)
        assertTrue(summary.hasLoginEvidence)
    }
}
