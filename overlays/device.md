# Overlay: device (Raspberry Pi / remote host)

- Put hardware, OS, and network behind a port (interface). The domain logic is tested on the dev machine against a fake of that port; the fake lives next to the port.
- Scenarios tagged `@device` run on the real device over ssh as smoke checks. They are separate from CI-safe scenarios and are HITL unless I said the device is expendable.
- Deploys must be idempotent and support dry-run and rollback (previous release kept, systemd unit restart, health check). Write that as its own early slice.
- Never run destructive or irreversible commands on a device without asking me first (disk, partition, network config, firmware, anything that could lock me out).
- Evidence: command output, service status, journal lines, and the version/commit running on the device.
- Record device state assumptions (OS version, packages, paths) in the spec so a fresh device can be rebuilt.
