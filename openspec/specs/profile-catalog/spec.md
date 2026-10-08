# profile-catalog Specification

## Purpose
Defines where profiles are read from, what content is legal, and which definition wins among same-named profiles. It is the data source of the profile selection mechanism: the other three capability domains all start from the definitions resolved by this one.

## Requirements

### Requirement: Catalog directory locations and discovery

The system SHALL read profile definitions from two locations: the global catalog and the project catalog.

The global catalog is the `profiles/` directory under the workspace root, which defaults to `~/.pi-profile-switch` and can be overridden by `PI_PROFILE_SWITCH_DIR`.

The project catalog is the `<projectDir>/.pi/profiles/` directory.

Each regular file with the `.json` extension in the directory SHALL define one profile; the filename minus the `.json` suffix is the profile name. Other entries (non-`.json` files, subdirectories) SHALL be ignored.

A missing directory SHALL be treated as an empty catalog, not an error. The system MUST NOT read any historical paths outside the two locations above.

#### Scenario: Workspace root overridden by environment variable

- **WHEN** `PI_PROFILE_SWITCH_DIR` is set and a `profiles/` directory exists under it
- **THEN** the system reads that directory as the global catalog and does not read the default workspace root

#### Scenario: Directory does not exist

- **WHEN** the global or project `profiles/` directory does not exist
- **THEN** the corresponding catalog is treated as empty, without an error

#### Scenario: Non-JSON entries are ignored

- **WHEN** a `profiles/` directory contains `review.json`, a subdirectory, and a file without the `.json` suffix
- **THEN** only `review.json` participates in resolution; the other entries produce neither errors nor profiles

### Requirement: Catalog file format validation

The system SHALL report an error when any profile file's content is illegal and MUST NOT degrade silently.

Each profile file's top-level value SHALL be an object — the complete definition of that profile — without envelope fields such as `schemaVersion`. The JSON syntax SHALL be legal.

Validation failures SHALL be actionable: the error SHALL identify the file at fault; field-level errors SHALL additionally identify the profile name and field name.

#### Scenario: Illegal catalog content

- **WHEN** a profile file's content is not legal JSON, or its top-level value is not an object
- **THEN** the system reports an error whose message identifies the file at fault, and the whole catalog read fails

### Requirement: Profile definition fields

A profile definition SHALL be an object. Its supported fields SHALL defer to the authoritative profile schema in `schemas/profiles.schema.json`, including the optional `subagents` field.

`skills`, `extensions`, `mcps`, and `tools` SHALL be arrays of strings. `mcp_tools` SHALL be an object whose keys are literal MCP server names and whose values are arrays of literal MCP tool names as registered by Pi's built-in MCP extension; glob patterns SHALL be rejected for this profile field. `subagents` SHALL follow "Optional native subagent override definitions". The remaining supported fields SHALL be strings.

All fields are optional. Undeclared fields SHALL NOT produce any behavior change. An empty `mcp_tools` object SHALL have the same effect as an undeclared one; an empty list for a server SHALL remain distinct from an omitted server key. An explicitly empty `mcps` array SHALL be retained as an empty server selection and SHALL remain distinct from an undeclared `mcps` field.

On read, unlisted top-level keys SHALL be ignored. On write, only supported fields SHALL be written out. Unsupported fields inside a declared `subagents` object SHALL follow its field-specific validation contract rather than the top-level unknown-key rule.

#### Scenario: Field type mismatch

- **WHEN** a profile's `skills` contains a non-string item, its `defaultModel` is not a string, its `mcp_tools` is not an object of string arrays, its `subagents` declaration violates its field contract, or the definition itself is not an object
- **THEN** the system reports an error whose message identifies the profile name and the field at fault

#### Scenario: Undeclared fields do not affect behavior

- **WHEN** a profile declares only `skills`
- **THEN** that profile's model, thinking level, instructions, and native subagent settings receive no additional override

#### Scenario: Unknown keys are ignored and not written back

- **WHEN** a profile in the catalog carries an unlisted top-level key, and that profile is then rewritten via the wizard
- **THEN** reading does not fail because of that key, and the written-back file does not contain it

#### Scenario: Empty per-server list is retained

- **WHEN** a profile declares `mcp_tools: { "github": [] }`
- **THEN** the parsed definition retains the empty list for `github` rather than treating it as an absent field or absent server key

#### Scenario: Explicitly empty server selection is retained

- **WHEN** a profile declares `mcps: []`
- **THEN** the parsed definition retains the empty array and treats it as an explicit selection of no user-level servers, distinct from omitting `mcps`

#### Scenario: Glob is not a literal MCP tool selector

- **WHEN** an `mcp_tools` entry contains a glob pattern
- **THEN** the definition is rejected with an actionable field error explaining that literal MCP tool names are required

#### Scenario: Special-looking server keys remain data

- **WHEN** a JSON profile declares an `mcp_tools` server key such as `toString` or `__proto__`
- **THEN** parsing retains it as an explicit server key for resolution; it is neither discarded nor implicitly treated as a discovered server

### Requirement: Optional native subagent override definitions

A profile SHALL accept the native-shaped optional subagent override subset defined by `schemas/profiles.schema.json`. Accepted thinking levels SHALL defer to Pi's supported thinking-level contract. Field types and supported native clearing values SHALL agree between the runtime parser and the shipped schema.

An omitted declaration, an empty declaration, an empty agent override map, or a map containing only empty role entries SHALL express no subagent control. Native clearing values and explicitly false boolean values SHALL remain distinct from omission.

Role-map keys SHALL identify exact, case-sensitive canonical agent names rather than patterns or an availability list. Empty, surrounding-whitespace, and glob-pattern keys SHALL be rejected. Special-looking JSON keys SHALL remain own data properties.

Malformed shapes, blank text values, invalid thinking values, and unsupported nested fields SHALL fail catalog validation. An actionable error SHALL identify the profile file, profile name, full nested field path, and the expected form or supported-field candidates. Previously configured native fields outside the profile's supported subset SHALL remain legal in the user's Pi settings; the subset restricts profile declarations only.

#### Scenario: Supported role overrides are accepted

- **WHEN** a profile declares a reviewer model, a supported thinking level, a nonempty description, and a boolean advertisement value
- **THEN** the parser accepts those fields and the shipped schema accepts the same definition

#### Scenario: Empty declarations express no control

- **WHEN** a profile omits `subagents`, declares `subagents: {}`, or declares an agent override map whose entries are all empty
- **THEN** it declares no additional subagent behavior and does not create an empty role-availability selection

#### Scenario: False values survive parsing

- **WHEN** a role override uses native clearing values for model or thinking and sets `advertise: false`
- **THEN** parsing retains each explicitly false field for native consumption instead of treating it as absent

#### Scenario: Invalid nested field reports its full path

- **WHEN** `subagents.agentOverrides.reviewer.advertise` is not a boolean or a declared text field is blank
- **THEN** validation fails naming the file, profile, full nested field path, and expected form

#### Scenario: Unsupported child policy is rejected

- **WHEN** a profile places a child-tool selection, child-skill selection, role-disable field, or role-availability list inside `subagents`
- **THEN** validation rejects the unsupported nested field with supported-field candidates rather than silently ignoring it

#### Scenario: Unsupported thinking value is rejected

- **WHEN** a declared shared or role-specific thinking value is outside Pi's supported thinking contract
- **THEN** validation fails at that nested field and offers the accepted values derived from the authoritative contract

#### Scenario: Role name patterns are rejected

- **WHEN** an override-map key is a glob pattern, an empty name, or a name with surrounding whitespace
- **THEN** validation fails explaining that an exact canonical agent name is required

#### Scenario: Special-looking agent keys remain data

- **WHEN** a JSON profile contains `toString` or `__proto__` as an agent override key
- **THEN** parsing preserves it as an own data entry without modifying object prototypes or inventing an agent registration

#### Scenario: Project profile replacement does not inherit child settings

- **WHEN** a global profile declares subagent overrides and a same-named trusted-project profile omits them
- **THEN** the winning project profile contains no inherited global-profile subagent declaration

### Requirement: Built-in default profile

The system SHALL always provide a built-in profile named `default`, whose source is `builtin` and whose definition contains no fields.

`default` MUST NOT be defined in a catalog: a `default.json` under any profiles directory is an error. `default` MUST NOT be editable and MUST NOT be deletable.

#### Scenario: Default defined in a catalog

- **WHEN** a `default.json` exists under any profiles directory
- **THEN** the system reports an error whose message identifies the file path

### Requirement: Profile sources and project override

Every resolvable profile SHALL carry a source: `builtin`, `global`, or `project`. Global catalog entries have source `global`; project catalog entries have source `project`.

A project entry SHALL completely replace a same-named global entry and MUST NOT merge with or append to any of its fields. Once the project entry is deleted, the same-named global entry SHALL become resolvable again immediately.

#### Scenario: Project entry completely replaces global entry

- **WHEN** both the global and project catalogs define `review`, the global declaring `skills: ["a"]` and the project declaring `tools: ["read"]`
- **THEN** resolving `review` yields source `project` and a definition containing only `tools: ["read"]`

#### Scenario: Global entry restored after project override deleted

- **WHEN** the project catalog deletes the `review` from the previous example
- **THEN** resolving `review` yields source `global` and the globally declared definition

### Requirement: Project trust gate

The project catalog's content SHALL participate in resolution only when the project is trusted. When the project is untrusted, the system MUST NOT read any file of the project catalog, and writes with project scope SHALL fail.

#### Scenario: Untrusted project's catalog files are not read

- **WHEN** the project is untrusted and a `.pi/profiles/` directory exists under it
- **THEN** reads with project scope return an empty result without an error, and the files in that directory are not read

#### Scenario: Writing to an untrusted project's catalog

- **WHEN** any write is performed with project scope while the project is untrusted
- **THEN** the operation fails with a message stating that the directory is untrusted

### Requirement: Profile list ordering

The list SHALL start with `default`, followed by global entries in filename lexicographic order, then names that exist only in the project catalog, also in filename lexicographic order.

#### Scenario: List ordering

- **WHEN** the global catalog contains `b.json` and `a.json`, and the project catalog contains `c.json`
- **THEN** the list order is `default`, `a`, `b`, `c`

### Requirement: Seeding the starter profile

When the package is installed and on every launcher startup, if the global profiles directory contains no profile file yet, the system SHALL write the starter profile file shipped with the package, defining a profile named `ask`. When any profile file already exists in the directory, it MUST NOT be overwritten. Seeding at launcher startup SHALL complete before the initial profile is resolved, so the seeded result is visible to this launch. Seeding failure MUST NOT fail the install or the launch and SHALL degrade to a warning.

#### Scenario: First install

- **WHEN** the global `profiles/` directory does not exist or contains no `.json` file
- **THEN** the starter profile file `ask.json` is written

#### Scenario: Existing catalog

- **WHEN** the global `profiles/` directory already contains at least one `.json` file
- **THEN** no new file is written and the install continues

#### Scenario: Backfill at startup

- **WHEN** the launcher starts and the global `profiles/` directory contains no `.json` file (e.g. install-time seeding was skipped)
- **THEN** the startup flow writes the starter profile file `ask.json`, and that profile is visible to this launch's initial profile resolution

#### Scenario: No overwrite at startup

- **WHEN** the launcher starts and the global `profiles/` directory already contains at least one `.json` file
- **THEN** no new file is written and startup continues

#### Scenario: Startup seeding failure degrades to a warning

- **WHEN** the seeding write fails at launcher startup (e.g. the target directory is not writable)
- **THEN** a warning is printed and startup continues

### Requirement: Distributing the profile-config skill

When the package is installed and on every launcher startup, the system SHALL write the shipped `profile-config` skill into the user agentDir's `skills/profile-config/` directory. The skill guides the agent to create, modify, and delete profile files.

The skill is an ordinary user-level resource: the system MUST NOT introduce filtering exemptions or runtime special-casing for it. Its session visibility SHALL follow "Sparse skill and extension selection" and "Narrowing boundary of project-level resources" in the resource-reference specification.

When an existing skill file's content differs from the shipped version it SHALL be overwritten with the shipped version; when the content matches, nothing is written. Distribution failure MUST NOT fail the install or the launch and SHALL degrade to a warning.

#### Scenario: First install

- **WHEN** `profile-config` does not yet exist under the user agentDir's `skills/`
- **THEN** the install writes the shipped skill files

#### Scenario: Upgrade overwrite

- **WHEN** the user agentDir's `skills/profile-config/` already exists and its content differs from the shipped version
- **THEN** the install overwrites it with the shipped version

#### Scenario: Distribution failure degrades to a warning

- **WHEN** writing the skill files fails at install time (e.g. the target directory is not writable)
- **THEN** the install degrades to a warning and continues; the install itself does not fail

#### Scenario: Backfill or sync at startup

- **WHEN** the launcher starts and the user agentDir's `skills/profile-config/SKILL.md` does not exist or its content differs from the shipped version (e.g. install-time distribution was skipped, or the package has been upgraded)
- **THEN** the startup flow writes or overwrites it with the shipped version, making it available to ordinary skill discovery; its session visibility follows the resource-reference contract

#### Scenario: Content already in sync at startup

- **WHEN** the launcher starts and `skills/profile-config/SKILL.md` content already matches the shipped version
- **THEN** no file is written and startup continues

#### Scenario: Startup distribution failure degrades to a warning

- **WHEN** writing the skill files fails at launcher startup (e.g. the target directory is not writable)
- **THEN** a warning is printed and startup continues

#### Scenario: Omitted skills includes the ordinary configuration skill

- **WHEN** a named profile omits `skills` and native user settings allow the distributed `profile-config` skill
- **THEN** the skill is available without adding a profile reference or applying a filtering exemption

#### Scenario: Explicit selection can exclude the configuration skill

- **WHEN** a named profile declares an empty skill list or a reference list that does not select `profile-config`
- **THEN** the distributed skill remains installed but is not visible in the session

#### Scenario: Native exclusion still hides the configuration skill

- **WHEN** native user settings exclude `profile-config` and the named profile omits `skills`
- **THEN** distribution does not bypass that exclusion or force the skill into the session

### Requirement: Profile name constraints

Profile names SHALL match `^[A-Za-z0-9][A-Za-z0-9._-]*$`. On read, a `.json` file with an illegal name in the profiles directory SHALL be an error identifying the file path; on write, an illegal name SHALL fail with an explanation of the rule.

Two names differing only in case are the same file on case-insensitive filesystems; the system SHALL NOT provide extra validation for this case.

#### Scenario: File with an illegal name

- **WHEN** the global `profiles/` directory contains `我的 profile.json`
- **THEN** the system reports an error whose message identifies the file path and the name rule

#### Scenario: Writing an illegal name

- **WHEN** creating a profile named `foo bar`
- **THEN** the operation fails with a message explaining the allowed name charset
