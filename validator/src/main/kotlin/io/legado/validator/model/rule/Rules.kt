package io.legado.validator.model.rule

data class SearchRule(
    var bookList: String? = null,
    var name: String? = null,
    var author: String? = null,
    var bookUrl: String? = null,
    var coverUrl: String? = null,
    var intro: String? = null,
    var kind: String? = null,
    var lastChapter: String? = null,
    var wordCount: String? = null,
    var checkKeyWord: String? = null
)

data class BookInfoRule(
    var init: String? = null,
    var name: String? = null,
    var author: String? = null,
    var coverUrl: String? = null,
    var intro: String? = null,
    var kind: String? = null,
    var lastChapter: String? = null,
    var updateTime: String? = null,
    var wordCount: String? = null,
    var tocUrl: String? = null,
    var canReName: String? = null,
    var downloadUrls: String? = null
)

data class TocRule(
    var preUpdateJs: String? = null,
    var chapterList: String? = null,
    var chapterName: String? = null,
    var chapterUrl: String? = null,
    var formatJs: String? = null,
    var isVolume: String? = null,
    var isVip: String? = null,
    var isPay: String? = null,
    var updateTime: String? = null,
    var nextTocUrl: String? = null
)

data class ContentRule(
    var content: String? = null,
    var title: String? = null,
    var nextContentUrl: String? = null,
    var webJs: String? = null,
    var sourceRegex: String? = null,
    var replaceRegex: String? = null,
    var imageStyle: String? = null,
    var imageDecode: String? = null,
    var payAction: String? = null
)
