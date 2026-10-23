# Wallet connection and disconnect

The sidebar wallet control opens the native AppKit Account view when connected
and the native Connect view when disconnected, using public `kit.open()` with
the eip155 namespace. Native account information and supported Fund, Send and
Activity actions remain owned by Reown. There is no custom account modal/menu.

The separate sidebar Logout icon calls UNMET's direct disconnect handler. It
acquires a synchronous lock before awaiting `kit.disconnect("eip155")`, shows
Sonner pending feedback, blocks wallet-dependent transaction/recovery entry
points and ignores duplicate requests. Read-only navigation remains available.
Account/provider state follows SDK confirmation. Success means the UNMET wallet
session ended; it does not prove wallet site authorization was revoked.

## Native Account disconnect limitation

AppKit/Ethers Adapter 1.8.24 handles the native Account Disconnect internally;
it does not call UNMET's direct handler or acquire its synchronous lock.
The inspected public `subscribeEvents` types expose DISCONNECT_SUCCESS and
DISCONNECT_ERROR, but no dedicated disconnect-start notification. Public
`subscribeState` exposes generic `open` and `loading` flags, not a reliable
disconnect-pending signal. Modal openness also cannot cover a request that
continues after the modal is dismissed. These flags are not treated as proof
that a native disconnect is pending.

Consequently, the direct-handler pending guard is not guaranteed for native
disconnect. Dismissing the native modal while its SDK request is pending can
leave UNMET transaction controls available until the SDK account changes.
Existing account/provider/transaction checks remain, but do not close this
pending-state gap. Native-modal transaction guarding requires a reliable public
SDK hook before it can be claimed. No SDK internals are patched or intercepted.

OKX testing observed approximately five seconds in `wallet_getPermissions`.
The adapter awaits permission handling, catches its errors and can still clear
the SDK session. Neither the permission query nor revocation is bypassed.
Draft answers and wallet-scoped pending transaction recovery are preserved;
results from an earlier wallet session are excluded from the current chat UI.

## Wallet session transitions

Create Demand compares wallet identities in render using state. Its layout
effect renews the callback token and resets operation locks only after a wallet
change commits. A suspended render cannot invalidate the previous committed
wallet. Committed disconnect/reconnect transitions renew the session even when
the same address reconnects. Draft answers and pricing inputs remain intact.

App transaction entry points capture the originating provider, account and
session generation. Account/provider changes invalidate unsigned stages. The
operation's viem transport validates the current account and chain immediately
before forwarding each signing request, including viem's alternate send method.
Already-forwarded requests cannot be recalled; broadcast receipt monitoring and
wallet-scoped recovery records continue independently of wallet changes. This
does not detect native disconnect pending before the SDK reports a change.

Run `bun run test:frontend` for mocked wallet/RPC regressions. With the frontend
dev server running, open `/tests/create-demand-chat-race.html` for the real
component Suspense/startTransition and committed-session regression. Its final
result must say PASS. The browser fixture uses synthetic outcomes and submits
no wallet transactions.
