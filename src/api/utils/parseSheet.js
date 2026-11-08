// The reader lives in src/lib so the browser can run it too: contact imports
// are read and checked in the browser, which keeps the Worker under the Free
// plan's 10 ms CPU limit. The Worker's older multipart import still uses it.
export * from '../../lib/parseSheet.js'
