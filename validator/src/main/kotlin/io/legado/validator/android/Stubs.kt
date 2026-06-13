package io.legado.validator.android

import java.util.Base64 as JvmBase64

object TextUtils {
    fun isEmpty(str: CharSequence?): Boolean = str.isNullOrEmpty()
    fun join(delimiter: CharSequence, items: Array<*>): String =
        items.joinToString(delimiter.toString())
}

object AndroidBase64 {
    const val DEFAULT = 0
    const val NO_WRAP = 2
    const val URL_SAFE = 8

    fun encodeToString(input: ByteArray, flags: Int = DEFAULT): String {
        return when {
            flags and URL_SAFE != 0 -> JvmBase64.getUrlEncoder().withoutPadding().encodeToString(input)
            else -> JvmBase64.getEncoder().encodeToString(input)
        }
    }

    fun decode(str: String, flags: Int = DEFAULT): ByteArray {
        return when {
            flags and URL_SAFE != 0 -> JvmBase64.getUrlDecoder().decode(str)
            else -> JvmBase64.getDecoder().decode(str)
        }
    }
}

@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.BINARY)
annotation class Keep
