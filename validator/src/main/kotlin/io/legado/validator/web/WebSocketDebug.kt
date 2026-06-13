package io.legado.validator.web

import com.google.gson.Gson
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import io.legado.validator.debug.DebugService
import io.legado.validator.debug.compact
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean

class WebSocketDebug(
    handshake: NanoHTTPD.IHTTPSession,
    private val debugService: DebugService
) : NanoWSD.WebSocket(handshake) {
    private val closed = AtomicBoolean(false)

    override fun onOpen() {
        debugService.getSteps().compact().forEach { step ->
            if (!closed.get()) {
                try { send(Gson().toJson(step)) } catch (_: IOException) {}
            }
        }
        debugService.onStep { step ->
            if (closed.get()) return@onStep
            try {
                send(Gson().toJson(step.compact()))
                if (step.status == "error" || (step.phase == "content" && step.status == "success")) {
                    closed.set(true)
                    close(NanoWSD.WebSocketFrame.CloseCode.NormalClosure, "done", false)
                }
            } catch (e: IOException) {
                closed.set(true)
            }
        }
    }

    override fun onClose(code: NanoWSD.WebSocketFrame.CloseCode?, reason: String?, initiatedByRemote: Boolean) {
        closed.set(true)
    }

    override fun onMessage(frame: NanoWSD.WebSocketFrame) {}
    override fun onPong(pong: NanoWSD.WebSocketFrame?) {}
    override fun onException(exception: IOException) {
        closed.set(true)
    }
}
