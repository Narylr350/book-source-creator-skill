package io.legado.validator

import io.legado.validator.web.WebServer

fun main() {
    val port = 1111
    val server = WebServer(port)
    server.start()
    println("Legado Source Validator started at http://localhost:$port")
    println("Press Ctrl+C to stop.")
    Thread.currentThread().join()
}
