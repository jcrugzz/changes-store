# changes-store

A simple in memory key-val store that is generated by a couch database or view
and is auto invalidated. An optional transform stream can be passed in to filter
the stream but it expects that you don't modify the structure (expects a `change`
object with a document still), but the document itself can be modified;