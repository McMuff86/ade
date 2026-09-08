This self-signed certificate and public test private key are fixtures only.
They identify `ade-mobile.fixture.ts.net` on loopback in browser automation.
No production listener uses them. The Playwright driver explicitly accepts
this certificate; the actual Tailscale acceptance probe must validate its
real certificate normally.
