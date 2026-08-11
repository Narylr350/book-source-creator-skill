package io.legado.validator

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class AppTest {
    @Test
    fun `command line port takes priority`() {
        assertEquals(49152, resolvePort(arrayOf("--port", "49152"), mapOf("LEGADO_VALIDATOR_PORT" to "50000")))
    }

    @Test
    fun `environment port is accepted`() {
        assertEquals(50000, resolvePort(emptyArray(), mapOf("LEGADO_VALIDATOR_PORT" to "50000")))
    }

    @Test
    fun `missing port is rejected`() {
        assertThrows(IllegalStateException::class.java) {
            resolvePort(emptyArray(), emptyMap())
        }
    }
}
