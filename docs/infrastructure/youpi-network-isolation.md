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

YouPI is expected at `10.90.0.2` with DNS alias `youpi-app`.

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

## Known pitfalls

- **Stale ARP.** Restarting a container on `youpi-net` gives it a new MAC. Other
  containers can keep a stale neighbour entry and time out. Fix from the client:
  `ip neigh flush <target>` or `ip neigh flush dev eth0`.
- **Dynamic IPs break the allow.** If `10.90.0.254` changes, verification fails
  loudly — pin the address on recreation, never rely on Podman assignment.
- **`policy accept` must stay.** Changing it to `drop` affects all host
  forwarding and would break ExamDump.
- **YouPI ports stay unpublished.** Never add `-p` for a YouPI service; nginx
  reaches it over the shared bridge. Published ports bypass this model entirely.
