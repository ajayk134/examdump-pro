# YouPI-PG Network Isolation

Enforceable network separation between ExamDump and YouPI-PG on the shared VPS.
Implemented 2026-11-13. Read this before changing anything in either network.

## Topology

| Network | Subnet | Bridge | Members |
| --- | --- | --- | --- |
| `examdump-pro_examdump` | `10.89.0.0/24` | `podman1` | api, web, postgres, nginx |
| `youpi-net` | `10.90.0.0/24` | `podman2` | nginx (second interface), YouPI (future) |
| `podman` | `10.88.0.0/16` | `podman0` | unused |

`examdump-pro_nginx_1` is **dual-homed** with pinned addresses:

- `10.89.0.67` — ExamDump side
- `10.90.0.254` — YouPI side (stable, must not change)

YouPI is expected at `10.90.0.2` with DNS alias `youpi-app` and a **pinned MAC**
`02:59:4f:11:00:02`. The pinned MAC is required, not cosmetic — see
[Stable identity](#stable-identity) below.

Reserved addresses on `youpi-net`: `.1` gateway, `.2` YouPI application,
`.254` nginx. Assign only from `.100` and above for anything else.

## Why this exists

Netavark's default FORWARD chain contains a blanket `ip saddr 10.89.0.0/24 accept`
under a `policy accept` FORWARD chain, so **every Podman bridge can reach every
other Podman bridge**. Netavark's own `--opt isolate=true` was tested and rejected:

- it only restricts **outbound** traffic from the isolated network, not inbound;
- in the test it bound the isolation chain to the wrong bridge index
  (`yt-isolated` landed on `podman3` while the rule referenced `podman2`),
  so it blocked nothing.

Do not reintroduce `isolate=true` as an isolation mechanism.

## Enforcement

`/etc/nftables.d/youpi-guard.nft` defines `table inet youpi_guard`, hook
`forward` at **priority -10** so it evaluates before `NETAVARK_FORWARD`
(`priority 0`). First match wins in nftables, so these denies beat Netavark's
blanket accept.

```
ip saddr 10.89.0.0/24 ip daddr 10.90.0.0/24 counter drop                  # ExamDump -> YouPI
ip saddr 10.90.0.0/24 ip daddr 10.89.0.0/24 ct state new counter drop     # YouPI -> ExamDump
ct state established,related counter accept                               # responses only
policy accept                                                             # unrelated traffic untouched
```

The `established,related` accept is deliberately **after** the denies: denies win
for new flows, and responses are accepted only for connections already permitted.

nginx reaches YouPI because traffic from `10.90.0.254` to `10.90.0.2` stays
**within the same bridge** and never traverses the FORWARD chain. Only nginx's
YouPI-side address is on that subnet, so the allow is scoped to it implicitly.
Sourcing from the ExamDump-side address (`10.89.0.67`) is dropped by rule 1.

## Persistence

| Event | Mechanism |
| --- | --- |
| Netavark regeneration | Guard lives in a separate `inet` table Netavark never touches |
| Podman network recreate | Same; verified |
| Firewall reload | `systemctl reload youpi-guard` |
| Host reboot | `youpi-guard.service` (enabled, `WantedBy=multi-user.target`) |

`nftables.service` is **disabled** on this host (firewalld manages Netavark
rules), so the guard ships with its own unit rather than an `nftables.d` include.

## Operations

```bash
systemctl status youpi-guard
sudo nft list table inet youpi_guard          # counters show blocked packets
sudo systemctl reload youpi-guard             # re-apply file after edit
sudo nft -c -f /etc/nftables.d/youpi-guard.nft  # syntax check before reload
```

## Rollback

```bash
sudo systemctl disable --now youpi-guard
sudo nft delete table inet youpi_guard
```

ExamDump is unaffected by rollback — it never depended on the guard. To also
return nginx to single-homed, recreate it with only
`--network examdump-pro_examdump:ip=10.89.0.67`.

## Verification matrix

Negative (blocked) and positive (allowed) paths must both be re-tested after any
network change:

| Path | Expected |
| --- | --- |
| api → YouPI | blocked |
| web → YouPI | blocked |
| postgres → YouPI | blocked |
| YouPI → api:4000 | blocked |
| YouPI → postgres:5432 | blocked |
| nginx → YouPI | 200 |
| nginx → api | 200 |

## Stable identity

Podman assigns a **random MAC** to every new container. nginx has no `NET_ADMIN`
capability, so it cannot flush or repair its own ARP cache. The combination
breaks connectivity on every YouPI recreation:

1. a new YouPI container gets a new MAC at the same address `.2`;
2. nginx keeps the previous MAC cached as a complete (`0x2`) ARP entry;
3. packets go to a MAC that no longer exists and are silently dropped;
4. the stale entry survives long enough to block requests indefinitely.

Measured on 5 unpinned recreations: **3 of 5 cycles failed completely**, including
via DNS alias. A host-side `ip neigh flush dev podman2` does not reach the
container netns. Warming the path from another container does not help either.

**The fix is pinning the MAC**, so the address/MAC pair is invariant and the
cached entry stays valid:

```bash
podman run -d --name youpi-app \
  --network youpi-net:ip=10.90.0.2,mac=02:59:4f:11:00:02 \
  --network-alias youpi-app
```

Measured with the MAC pinned: **8 of 8 recreation cycles succeeded**, every one
answering 200 on both the static IP and the alias.

If a container must be recreated with a different MAC, connectivity recovers on
its own once the stale entry ages out to `FAILED` and is re-resolved — but that
window is unbounded and must not be relied on. Always pin.

## Known pitfalls

- **Stale ARP.** Restarting a container on `youpi-net` gives it a new MAC and
  nginx cannot clear its own cache. Pin the MAC (see above); do not rely on
  flushing, which requires `NET_ADMIN` that the nginx container does not have.
- **Network recreation detaches interfaces.** After `podman network rm` and
  recreate, existing containers keep stale interface state until recreated.
  Re-run the verification matrix afterwards; the guard itself survives.
- **Dynamic IPs break the allow.** If `10.90.0.254` changes, verification fails
  loudly — pin the address on recreation, never rely on Podman assignment.
- **`policy accept` must stay.** Changing it to `drop` affects all host
  forwarding and would break ExamDump.
- **YouPI ports stay unpublished.** Never add `-p` for a YouPI service; nginx
  reaches it over the shared bridge. Published ports bypass this model entirely.
