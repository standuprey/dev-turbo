# Overlay: cli

- The CLI application is the owning module. Keep argument parsing, presentation, orchestration, domain logic and external effects separate; follow the repo's conventions and avoid generic frameworks or plugin systems.
- Test at the command boundary: arguments and stdin in; exit status, stdout/stderr and persisted results out, including invalid input, failures and interruption. Preserve documented commands, flags, defaults, output formats and state locations unless a change is approved.
- Keep parser objects in command adapters; inject filesystem, subprocess, network, clock and prompts where useful. Test domain logic directly, without patching re-exports.
- Run entrypoints as subprocesses from an unrelated directory. Help and completion work without credentials, network or state writes. Test installation and completion with temporary HOME, PATH and state directories; never touch real shell startup files.
- Use synthetic data and temporary state; mock remote services, paid inference, package managers and destructive subprocesses. Ask before live billable calls, publishing, modifying real data or installing system packages. Keep secrets out of verification notes.
- Preserve preflight checks, billing confirmations, locking, atomic writes, overwrite protection and cancellation diagnostics; local cancellation does not mean remote work stopped.
- Keep concurrency, queues, memory, retries and output bounded; retries need finite attempts and backoff.
- Run formatting, type/lint checks and affected tests with the `checks` command. Save the command, exit status and result through `dt.mjs progress --verification`, noting skips and mocks. Do not create an `evidence/` folder or save full logs; link useful artifacts in `--verification`.
- A local browser UI also follows the web overlay.
