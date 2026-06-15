package io.legado.validator.web

import com.google.gson.Gson
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import io.legado.validator.debug.DebugService
import io.legado.validator.debug.DebugStep
import io.legado.validator.debug.compact
import io.legado.validator.model.BookSource
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
        return newFixedLengthResponse(Response.Status.OK, mime, bytes.inputStream(), bytes.size.toLong())
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
            val sourceJsonElement = req.get("sourceJson")
                ?: return newFixedLengthResponse(Response.Status.BAD_REQUEST, "application/json",
                    """{"ok":false,"error":"Missing sourceJson"}""")
            val sourceJson = if (sourceJsonElement.isJsonPrimitive) sourceJsonElement.asString
                else sourceJsonElement.toString()
            val sourceUrl = req.get("sourceUrl")?.asString
                ?: return newFixedLengthResponse(Response.Status.BAD_REQUEST, "application/json",
                    """{"ok":false,"error":"Missing sourceUrl"}""")
            val keyword = req.get("keyword")?.asString
                ?: return newFixedLengthResponse(Response.Status.BAD_REQUEST, "application/json",
                    """{"ok":false,"error":"Missing keyword"}""")
            val mode = req.get("mode")?.asString ?: "http"

            // Import source
            val list = BookSource.fromJson(sourceJson)
            list.forEach { sources[it.bookSourceUrl] = it }
            val source = sources[sourceUrl]
                ?: return newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json",
                    """{"ok":false,"error":"Source not found after import: $sourceUrl"}""")

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

            val result = buildString {
                append("""{"ok":true,"phases":{""")
                phases.entries.joinTo(this) { "\"${it.key}\":\"${it.value}\"" }
                append("""},"summary":{"resultCount":$resultCount,"firstBook":"${firstBook.replace("\"", "\\\"")}","chapterCount":$chapterCount,"contentPreview":"${contentPreview.replace("\"", "\\\"").replace("\n", "\\n")}"""")
                if (errorMessage != null) {
                    append(""","error":"${errorMessage.replace("\"", "\\\"").replace("\n", "\\n")}"""")
                }
                append("""},"steps":""")
                append(Gson().toJson(compactSteps))
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
            val casesDir = req.get("casesDir")?.asString
                ?: javaClass.getResource("/examples/cases")?.path
                ?: return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "application/json",
                    """{"ok":false,"error":"Cases directory not found"}""")
            val caseFilter = req.get("cases")?.asJsonArray?.map { it.asString }?.toSet()
            val casesDirFile = java.io.File(casesDir)
            if (!casesDirFile.exists()) {
                return newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json",
                    """{"ok":false,"error":"Cases directory not found: $casesDir"}""")
            }
            val caseFiles = casesDirFile.listFiles { f -> f.extension == "json" }?.sorted()
                ?: return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "application/json",
                    """{"ok":false,"error":"No case files found"}""")
            val results = mutableListOf<Map<String, Any?>>()
            for (caseFile in caseFiles) {
                if (caseFilter != null && !caseFilter.contains(caseFile.nameWithoutExtension)) continue
                try {
                    val caseJson = com.google.gson.JsonParser.parseString(caseFile.readText()).asJsonObject
                    val caseName = caseJson.get("name")?.asString ?: caseFile.nameWithoutExtension
                    val category = caseJson.get("category")?.asString ?: "unknown"
                    val sourceFileName = caseJson.get("sourceFile")?.asString
                    val keyword = caseJson.get("keyword")?.asString ?: ""
                    val mode = caseJson.get("mode")?.asString ?: "http"
                    val expected = caseJson.get("expected")?.asJsonObject
                    val sourceFile = if (sourceFileName != null) {
                        java.io.File(casesDirFile.parentFile, sourceFileName)
                    } else null
                    if (sourceFile == null || !sourceFile.exists()) {
                        results.add(mapOf("case" to caseName, "category" to category, "status" to "skip", "reason" to "Source file not found"))
                        continue
                    }
                    val sourceJson = sourceFile.readText()
                    val sourceList = BookSource.fromJson(sourceJson)
                    sourceList.forEach { sources[it.bookSourceUrl] = it }
                    val source = sourceList.firstOrNull()
                    if (source == null) {
                        results.add(mapOf("case" to caseName, "category" to category, "status" to "skip", "reason" to "No source in file"))
                    } else {
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
                    }
                } catch (e: Exception) {
                    results.add(mapOf("case" to caseFile.nameWithoutExtension, "status" to "error", "error" to e.message))
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
}
