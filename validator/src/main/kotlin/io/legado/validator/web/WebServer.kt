package io.legado.validator.web

import com.google.gson.Gson
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import io.legado.validator.debug.DebugService
import io.legado.validator.debug.DebugStep
import io.legado.validator.debug.compact
import io.legado.validator.model.BookSource
import io.legado.validator.probe.AndroidProbeService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.util.Base64

class WebServer(port: Int) : NanoWSD(port) {
    private val sources = mutableMapOf<String, BookSource>()
    private val debugService = DebugService()

    override fun serveHttp(session: IHTTPSession): Response {
        val uri = session.uri
        if (uri.startsWith("/static/") || uri == "/" || uri == "/index.html") {
            return serveStatic(uri)
        }
        return when {
            uri == "/api/source/import" && session.method == Method.POST -> handleImportSource(session)
            uri == "/api/sources" && session.method == Method.GET -> handleListSources()
            uri == "/api/debug/start" && session.method == Method.POST -> handleStartDebug(session)
            uri == "/api/debug/steps" && session.method == Method.GET -> handleGetSteps()
            uri == "/api/debug/run" && session.method == Method.POST -> handleRunDebug(session)
            uri == "/api/debug/smoke" && session.method == Method.POST -> handleSmoke(session)
            uri == "/api/probe/status" && session.method == Method.GET -> handleProbeStatus()
            uri.startsWith("/api/source/") && session.method == Method.DELETE -> {
                val encoded = uri.removePrefix("/api/source/")
                val sourceUrl = String(Base64.getUrlDecoder().decode(encoded))
                sources.remove(sourceUrl)
                newFixedLengthResponse(Response.Status.OK, "application/json", """{"ok":true}""")
            }
            else -> newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not Found")
        }
    }

    override fun openWebSocket(handshake: IHTTPSession): WebSocket {
        return WebSocketDebug(handshake, debugService)
    }

    private fun serveStatic(uri: String): Response {
        val path = if (uri == "/" || uri == "/index.html") "/static/index.html" else uri
        val stream = javaClass.getResourceAsStream(path)
            ?: return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not Found")
        val mime = when {
            path.endsWith(".html") -> "text/html; charset=UTF-8"
            path.endsWith(".css") -> "text/css"
            path.endsWith(".js") -> "application/javascript"
            else -> "application/octet-stream"
        }
        val bytes = stream.readBytes()
        return newFixedLengthResponse(Response.Status.OK, mime, bytes.inputStream(), bytes.size.toLong()).apply {
            addHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            addHeader("Pragma", "no-cache")
        }
    }

    private fun handleImportSource(session: IHTTPSession): Response {
        val contentLength = session.headers["content-length"]?.toIntOrNull() ?: 0
        val rawBytes = readBody(session.inputStream, contentLength)
        val json = String(rawBytes, Charsets.UTF_8)
        return try {
            val list = BookSource.fromJson(json)
            list.forEach { sources[it.bookSourceUrl] = it }
            newFixedLengthResponse(Response.Status.OK, "application/json", """{"ok":true,"count":${list.size}}""")
        } catch (e: Exception) {
            newFixedLengthResponse(Response.Status.BAD_REQUEST, "application/json",
                """{"ok":false,"error":"${e.message?.replace("\"", "\\\"")}"}""")
        }
    }

    private fun handleListSources(): Response {
        val arr = sources.values.joinToString(",") {
            """{"url":"${it.bookSourceUrl}","name":"${it.bookSourceName}"}"""
        }
        return newFixedLengthResponse(Response.Status.OK, "application/json", "[$arr]")
    }

    private fun handleStartDebug(session: IHTTPSession): Response {
        val contentLength = session.headers["content-length"]?.toIntOrNull() ?: 0
        val rawBytes = readBody(session.inputStream, contentLength)
        val json = String(rawBytes, Charsets.UTF_8)
        val req = com.google.gson.JsonParser.parseString(json).asJsonObject
        val sourceUrl = req.get("sourceUrl")?.asString ?: return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Missing sourceUrl")
        val keyword = req.get("keyword")?.asString ?: return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Missing keyword")
        val mode = req.get("mode")?.asString ?: "http"
        val source = sources[sourceUrl] ?: return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Source not found")
        CoroutineScope(Dispatchers.IO).launch {
            try {
                debugService.runFull(source, keyword, mode)
            } catch (e: Exception) {
                println("[Debug] Error: ${e.message}")
            }
        }
        return newFixedLengthResponse(Response.Status.OK, "application/json", """{"ok":true}""")
    }

    private fun handleGetSteps(): Response {
        val steps = debugService.getSteps().compact()
        val json = Gson().toJson(steps)
        return newFixedLengthResponse(Response.Status.OK, "application/json", json)
    }

    private fun handleRunDebug(session: IHTTPSession): Response {
        val contentLength = session.headers["content-length"]?.toIntOrNull() ?: 0
        val rawBytes = readBody(session.inputStream, contentLength)
        val json = String(rawBytes, Charsets.UTF_8)
        return try {
            val req = com.google.gson.JsonParser.parseString(json).asJsonObject
            val sourceUrl = req.get("sourceUrl")?.asString
                ?: return newFixedLengthResponse(Response.Status.BAD_REQUEST, "application/json",
                    """{"ok":false,"error":"Missing sourceUrl"}""")
            val keyword = req.get("keyword")?.asString
                ?: return newFixedLengthResponse(Response.Status.BAD_REQUEST, "application/json",
                    """{"ok":false,"error":"Missing keyword"}""")
            val mode = req.get("mode")?.asString ?: "http"

            val sourceJsonElement = req.get("sourceJson")
            if (sourceJsonElement != null) {
                val sourceJson = if (sourceJsonElement.isJsonPrimitive) sourceJsonElement.asString
                    else sourceJsonElement.toString()
                val list = try {
                    BookSource.fromJson(sourceJson)
                } catch (_: Exception) {
                    listOf(BookSource.fromJsonObject(sourceJson))
                }
                list.forEach { sources[it.bookSourceUrl] = it }
            }
            val source = sources[sourceUrl]
                ?: return newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json",
                    """{"ok":false,"error":"Source not found: $sourceUrl"}""")

            // 每次创建独立 DebugService，避免并发串状态
            val runService = DebugService()
            val steps = runBlocking(Dispatchers.IO) {
                runService.runFull(source, keyword, mode)
            }

            // Build compact steps
            val compactSteps = steps.compact()

            // Build summary from compacted steps
            val phases = mutableMapOf<String, String>()
            var resultCount = 0
            var firstBook = ""
            var chapterCount = 0
            var contentPreview = ""
            var errorMessage: String? = null

            for (step in compactSteps) {
                phases[step.phase] = step.status
                when (step.phase) {
                    "search" -> {
                        resultCount = step.extracted["resultCount"] as? Int ?: 0
                        val fb = step.extracted["firstBook"]
                        firstBook = when (fb) {
                            is io.legado.validator.model.SearchBook -> fb.name
                            else -> fb?.toString() ?: ""
                        }
                    }
                    "toc" -> {
                        chapterCount = step.extracted["chapterCount"] as? Int ?: 0
                    }
                    "content" -> {
                        if (step.status == "success" && contentPreview.isEmpty()) {
                            contentPreview = step.preview?.take(200) ?: ""
                        }
                    }
                }
                if (step.status == "error" && errorMessage == null) {
                    errorMessage = step.error
                }
            }

            val finalStatus = io.legado.validator.debug.determineFinalStatus(steps)
            val allWarnings = steps.flatMap { it.compatibilityWarnings ?: emptyList() }.distinctBy { it.feature }

            val result = buildString {
                append("""{"ok":true,"finalStatus":"$finalStatus","phases":{""")
                phases.entries.joinTo(this) { "\"${it.key}\":\"${it.value}\"" }
                append("""},"summary":{"resultCount":$resultCount,"firstBook":"${firstBook.replace("\"", "\\\"")}","chapterCount":$chapterCount,"contentPreview":"${contentPreview.replace("\"", "\\\"").replace("\n", "\\n")}"""")
                if (errorMessage != null) {
                    append(""","error":"${errorMessage.replace("\"", "\\\"").replace("\n", "\\n")}"""")
                }
                append("""},"steps":""")
                append(Gson().toJson(compactSteps))
                if (allWarnings.isNotEmpty()) {
                    append(""","compatibilityWarnings":""")
                    append(Gson().toJson(allWarnings))
                }
                append("}")
            }
            newFixedLengthResponse(Response.Status.OK, "application/json", result)
        } catch (e: Exception) {
            newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "application/json",
                """{"ok":false,"error":"${e.message?.replace("\"", "\\\"")}"}""")
        }
    }

    private fun handleSmoke(session: IHTTPSession): Response {
        val contentLength = session.headers["content-length"]?.toIntOrNull() ?: 0
        val rawBytes = readBody(session.inputStream, contentLength)
        val json = String(rawBytes, Charsets.UTF_8)
        return try {
            val req = com.google.gson.JsonParser.parseString(json).asJsonObject
            val caseFilter = req.get("cases")?.asJsonArray?.map { it.asString }?.toSet()
            val externalCasesDir = req.get("casesDir")?.asString?.let { java.io.File(it) }

            // Collect case entries: name → JSON string
            data class CaseEntry(val name: String, val json: String, val sourceDir: java.io.File?)

            val cases = mutableListOf<CaseEntry>()

            if (externalCasesDir != null && externalCasesDir.exists()) {
                externalCasesDir.listFiles { f -> f.extension == "json" }?.sorted()?.forEach { f ->
                    cases.add(CaseEntry(f.nameWithoutExtension, f.readText(), externalCasesDir.parentFile))
                }
            } else {
                // Read from classpath
                val caseNames = listOf("biquges-full-pipeline", "69shuba-cloudflare", "163zw-js-rules", "json-api-placeholder", "kuwo-json-api", "zhide-crypto", "qidian-anti-scraping")
                for (name in caseNames) {
                    val stream = javaClass.getResourceAsStream("/examples/cases/$name.json")
                        ?: javaClass.getResourceAsStream("/examples/$name.json")
                    if (stream != null) {
                        cases.add(CaseEntry(name, stream.readBytes().toString(Charsets.UTF_8), null))
                    }
                }
            }

            if (cases.isEmpty()) {
                return newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json",
                    """{"ok":false,"error":"No cases found"}""")
            }

            val results = mutableListOf<Map<String, Any?>>()
            for (entry in cases) {
                if (caseFilter != null && !caseFilter.contains(entry.name)) continue
                try {
                    val caseJson = com.google.gson.JsonParser.parseString(entry.json).asJsonObject
                    val caseName = caseJson.get("name")?.asString ?: entry.name
                    val category = caseJson.get("category")?.asString ?: "unknown"
                    val sourceFileName = caseJson.get("sourceFile")?.asString
                    val keyword = caseJson.get("keyword")?.asString ?: ""
                    val mode = caseJson.get("mode")?.asString ?: "http"
                    val expected = caseJson.get("expected")?.asJsonObject

                    // Resolve source JSON
                    val sourceJson: String? = when {
                        entry.sourceDir != null && sourceFileName != null -> {
                            val sf = java.io.File(entry.sourceDir, sourceFileName)
                            if (sf.exists()) sf.readText() else null
                        }
                        sourceFileName != null -> {
                            val baseName = sourceFileName.substringAfterLast("/")
                            val stream = javaClass.getResourceAsStream("/examples/$sourceFileName")
                                ?: javaClass.getResourceAsStream("/examples/sources/$baseName")
                                ?: javaClass.getResourceAsStream("/examples/candidates/local-reference/$baseName")
                                ?: javaClass.getResourceAsStream("/examples/candidates/xiu2-yuedu/$baseName")
                                ?: javaClass.getResourceAsStream("/examples/candidates/entr0pia/$baseName")
                            stream?.readBytes()?.toString(Charsets.UTF_8)
                        }
                        else -> null
                    }
                    if (sourceJson == null) {
                        results.add(mapOf("case" to caseName, "category" to category, "status" to "skip", "reason" to "Source file not found"))
                        continue
                    }

                    val sourceList = try {
                        BookSource.fromJson(sourceJson)
                    } catch (_: Exception) {
                        // Try as single object
                        listOf(BookSource.fromJsonObject(sourceJson))
                    }
                    sourceList.forEach { sources[it.bookSourceUrl] = it }
                    val source = sourceList.firstOrNull()
                    if (source == null) {
                        results.add(mapOf("case" to caseName, "category" to category, "status" to "skip", "reason" to "No source in file"))
                        continue
                    }

                    val runService = DebugService()
                    val steps = runBlocking(Dispatchers.IO) { runService.runFull(source, keyword, mode) }
                    val compactSteps = steps.compact()
                    val phases = compactSteps.associate { it.phase to it.status }
                    val failures = mutableListOf<String>()
                    if (expected != null) {
                        for ((phase, expectedObj) in expected.entrySet()) {
                            val expectedPhase = expectedObj.asJsonObject
                            val actualStatus = phases[phase]
                            val expectedStatus = expectedPhase.get("status")?.asString
                            if (expectedStatus != null && actualStatus != expectedStatus) {
                                failures.add("$phase: expected $expectedStatus, got $actualStatus")
                            }
                            if (expectedStatus == "success") {
                                val step = compactSteps.find { it.phase == phase }
                                if (step != null) {
                                    val rc = expectedPhase.get("resultCount")?.asJsonObject
                                    if (rc != null) {
                                        val min = rc.get("min")?.asInt ?: 0
                                        val actual = step.extracted["resultCount"] as? Int ?: 0
                                        if (actual < min) failures.add("$phase.resultCount: expected >= $min, got $actual")
                                    }
                                    val cc = expectedPhase.get("chapterCount")?.asJsonObject
                                    if (cc != null) {
                                        val min = cc.get("min")?.asInt ?: 0
                                        val actual = step.extracted["chapterCount"] as? Int ?: 0
                                        if (actual < min) failures.add("$phase.chapterCount: expected >= $min, got $actual")
                                    }
                                    val cl = expectedPhase.get("contentLength")?.asJsonObject
                                    if (cl != null) {
                                        val min = cl.get("min")?.asInt ?: 0
                                        val actual = step.extracted["contentLength"] as? Int ?: 0
                                        if (actual < min) failures.add("$phase.contentLength: expected >= $min, got $actual")
                                    }
                                }
                            }
                        }
                    }
                    results.add(mapOf(
                        "case" to caseName,
                        "category" to category,
                        "status" to if (failures.isEmpty()) "pass" else "fail",
                        "phases" to phases,
                        "failures" to failures
                    ))
                } catch (e: Exception) {
                    results.add(mapOf("case" to entry.name, "status" to "error", "error" to e.message))
                }
            }
            val passCount = results.count { it["status"] == "pass" }
            val failCount = results.count { it["status"] == "fail" }
            val errorCount = results.count { it["status"] == "error" }
            val skipCount = results.count { it["status"] == "skip" }
            val report = mapOf(
                "ok" to true,
                "total" to results.size,
                "pass" to passCount,
                "fail" to failCount,
                "error" to errorCount,
                "skip" to skipCount,
                "results" to results
            )
            newFixedLengthResponse(Response.Status.OK, "application/json", Gson().toJson(report))
        } catch (e: Exception) {
            newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "application/json",
                """{"ok":false,"error":"${e.message?.replace("\"", "\\\"")}"}""")
        }
    }

    private fun readBody(inputStream: java.io.InputStream, contentLength: Int): ByteArray {
        val buffer = ByteArray(contentLength)
        var offset = 0
        while (offset < contentLength) {
            val read = inputStream.read(buffer, offset, contentLength - offset)
            if (read == -1) break
            offset += read
        }
        return if (offset == contentLength) buffer else buffer.copyOf(offset)
    }

    private fun handleProbeStatus(): Response {
        val info = AndroidProbeService.probeCheck()
        return newFixedLengthResponse(Response.Status.OK, "application/json", Gson().toJson(info))
    }
}
