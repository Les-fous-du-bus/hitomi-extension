# Research candidates

Files in this directory are not installable Hitomi extensions and are deliberately
absent from `index.json`. A successful desktop probe does not establish Android
reader or offline compatibility.

`manga/mangaplus.js` is a research prototype. On the Android bench, the service
rejected the generated anonymous session (`Account Banned`; no personal account
was used). Its XOR-encrypted image responses also require reader/downloader
support that Hitomi does not currently provide. Do not register this candidate
until those paths are implemented and verified with the actual Android runtime.
