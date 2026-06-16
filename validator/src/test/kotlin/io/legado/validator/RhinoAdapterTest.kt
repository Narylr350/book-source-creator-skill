package io.legado.validator

import io.legado.validator.analyzeRule.RhinoAdapter
import io.legado.validator.model.BookSource
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class RhinoAdapterTest {
    @Test
    fun `jsLib functions are available in eval`() {
        val source = BookSource(
            bookSourceUrl = "https://example.com",
            jsLib = "function double(x) { return x * 2; }"
        )
        val result = RhinoAdapter.eval("double(21)", mapOf("source" to source))
        assertEquals(42.0, result)
    }
}
