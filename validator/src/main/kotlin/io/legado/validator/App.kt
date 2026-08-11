package io.legado.validator

import io.legado.validator.web.WebServer

internal fun resolvePort(args: Array<String>, environment: Map<String, String> = System.getenv()): Int {
    val argumentPort = args.toList().windowed(2, 1)
        .firstOrNull { it[0] == "--port" }
        ?.get(1)
        ?.toIntOrNull()
    val port = argumentPort ?: environment["LEGADO_VALIDATOR_PORT"]?.toIntOrNull()
        ?: error("Validator port is required. Start it through bsg.mjs validator-start.")
    require(port in 1..65535) { "Validator port must be between 1 and 65535." }
    return port
}

fun main(args: Array<String>) {
    val port = resolvePort(args)
    val server = WebServer(port)
    server.start()
    println("Legado Source Validator started at http://localhost:$port")
    println("Press Ctrl+C to stop.")
    Thread.currentThread().join()
}
