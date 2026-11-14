---
'neode': patch
---
The server-startup cookbook recipe now authenticates its connectivity probe (the thrown-away driver used to fail auth on every authed server and burn the 15s timeout, then swallow the error and exit 0) and honours `PORT` instead of hardcoding 3000.
