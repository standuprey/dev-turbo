# Overlay: device (Raspberry Pi / remote host)

- Put hardware, OS and network behind a port; test domain logic locally against a fake next to the port.
- `@device` scenarios run on the real device over ssh as smoke checks, separate from CI-safe scenarios, and are HITL unless I said the device is expendable.
- Deploys are idempotent with dry-run and rollback (previous release kept, systemd restart, health check), as their own early ticket.
- Ask before destructive or irreversible device commands (disk, partition, network config, firmware, anything that could lock me out).
- Verification: command output, service status, journal lines and the running version/commit.
- Record device assumptions (OS version, packages, paths) in the spec so a fresh device can be rebuilt.
