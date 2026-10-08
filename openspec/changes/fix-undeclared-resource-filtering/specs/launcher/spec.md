# Spec Delta

## ADDED Requirements

### Requirement: Independent skill and extension materialization

Generated instance settings SHALL implement "Sparse skill and extension selection" from the resource-reference specification independently for each kind. For an undeclared kind without an overlay, the instance SHALL preserve the user's native resource settings and package-filter meaning, including the distinction between an absent package filter and an explicitly empty native package filter. Generated paths SHALL retain their native meaning when the agent directory changes.

Restricting one kind MUST NOT inject an empty filter for the other kind into a configured package. Native built-in extension controls SHALL remain effective when resource settings are rewritten. Source user settings and profile files MUST NOT be rewritten as part of activation.

#### Scenario: Mixed package preserves undeclared skills

- **WHEN** a configured package supplies skills and extensions, and a profile declares only an extension selection
- **THEN** the generated package entry narrows extensions while preserving the original skill-filter meaning and unrelated package properties

#### Scenario: Mixed package preserves undeclared extensions

- **WHEN** a configured package supplies skills and extensions, and a profile declares only a skill selection
- **THEN** the generated package entry narrows skills while preserving the original extension-filter meaning and unrelated package properties

#### Scenario: Native empty package filter remains empty

- **WHEN** native user settings explicitly disable one resource kind in a package with an empty filter and a profile omits that kind
- **THEN** generated settings keep that kind disabled rather than treating the native empty filter as unrestricted

#### Scenario: Native paths survive the instance boundary

- **WHEN** native skill or extension settings include absolute paths, paths relative to the real agent directory, or paths containing native include/exclude controls, and the profile omits that kind
- **THEN** the instance exposes the same enabled resources as native Pi and keeps the same exclusions effective

#### Scenario: Omitted kinds do not freeze package discovery

- **WHEN** an undeclared kind belongs to a configured package that read-only discovery cannot resolve before startup
- **THEN** generated settings preserve the native declaration instead of replacing that kind with an empty or discovery-derived allowlist

#### Scenario: Source files remain unchanged

- **WHEN** a named profile activates with omitted, empty, or mixed skill/extension fields
- **THEN** the real user settings and profile files remain byte-identical after activation
