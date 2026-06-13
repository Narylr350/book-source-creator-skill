package io.legado.validator.analyzeRule

import org.mozilla.javascript.Context
import org.mozilla.javascript.Scriptable

object RhinoAdapter {

    fun eval(jsStr: String, bindings: Map<String, Any?>): Any? {
        val cx = Context.enter()
        try {
            cx.optimizationLevel = -1
            cx.languageVersion = Context.VERSION_ES6
            val scope = cx.initStandardObjects()
            for ((key, value) in bindings) {
                scope.put(key, scope, Context.javaToJS(value, scope))
            }
            return cx.evaluateString(scope, jsStr, "script", 1, null)
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
