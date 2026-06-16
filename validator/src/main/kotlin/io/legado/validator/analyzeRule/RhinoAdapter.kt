package io.legado.validator.analyzeRule

import io.legado.validator.model.BookSource
import org.mozilla.javascript.Context
import org.mozilla.javascript.Scriptable
import java.util.concurrent.ConcurrentHashMap

object RhinoAdapter {

    private val scopeCache = ConcurrentHashMap<BookSource, Scriptable>()

    fun eval(jsStr: String, bindings: Map<String, Any?>): Any? {
        val source = bindings["source"] as? BookSource
        val cx = Context.enter()
        try {
            cx.optimizationLevel = -1
            cx.languageVersion = Context.VERSION_ES6
            val scope = if (source != null) {
                scopeCache.getOrPut(source) {
                    val s = cx.initStandardObjects()
                    val jsLib = source.jsLib
                    if (!jsLib.isNullOrBlank()) {
                        try { cx.evaluateString(s, jsLib, "jsLib", 1, null) }
                        catch (_: Exception) {}
                    }
                    s
                }
            } else {
                cx.initStandardObjects()
            }
            val childScope = cx.newObject(scope)
            childScope.prototype = scope
            for ((key, value) in bindings) {
                childScope.put(key, childScope, Context.javaToJS(value, childScope))
            }
            return cx.evaluateString(childScope, jsStr, "script", 1, null)
        } finally {
            Context.exit()
        }
    }

    fun getRuntimeScope(bindings: Map<String, Any?>): Scriptable {
        val cx = Context.enter()
        try {
            cx.optimizationLevel = -1
            cx.languageVersion = Context.VERSION_ES6
            val scope = cx.initStandardObjects()
            for ((key, value) in bindings) {
                scope.put(key, scope, Context.javaToJS(value, scope))
            }
            return scope
        } finally {
            Context.exit()
        }
    }

    fun evalWithScope(jsStr: String, scope: Scriptable): Any? {
        val cx = Context.enter()
        try {
            cx.optimizationLevel = -1
            cx.languageVersion = Context.VERSION_ES6
            return cx.evaluateString(scope, jsStr, "script", 1, null)
        } finally {
            Context.exit()
        }
    }
}
