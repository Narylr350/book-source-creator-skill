package io.legado.validator

import io.legado.validator.probe.AndroidProbeService
import io.legado.validator.probe.ProbeRenderRequest
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class P9ProbeTest {

    @Test
    fun `adb detection works or reports not available`() {
        val info = AndroidProbeService.probeCheck()
        assertNotNull(info)
        if (info.available) {
            assertNotNull(info.device)
            assertTrue(info.device!!.state == "device")
        } else {
            assertNotNull(info.error)
            assertFalse(info.error!!.contains("Exception"))
        }
    }

    @Test
    fun `probe ping works when device connected`() {
        val info = AndroidProbeService.probeCheck()
        if (info.available) {
            assertTrue(AndroidProbeService.ping())
        }
    }

    @Test
    fun `probe render returns html when device connected`() {
        val info = AndroidProbeService.probeCheck()
        if (!info.available) return

        val response = AndroidProbeService.render(
            ProbeRenderRequest(url = "https://example.com", screenshot = false)
        )
        assertTrue(response.ok, "Render should succeed: ${response.error}")
        assertNotNull(response.html)
        assertTrue(response.html!!.contains("Example Domain"))
        assertNotNull(response.finalUrl)
    }

    @Test
    fun `no device returns proper limitation`() {
        val info = AndroidProbeService.probeCheck()
        if (info.available) return

        assertFalse(info.available)
        assertNotNull(info.error)
        assertFalse(info.error!!.contains("Exception"))
    }
}
