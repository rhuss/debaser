# Handoff: {{patch}}

- Kind: {{kind}}
- Patch: {{description}} ({{link}})
- Upstream: {{upstream}}

## Problem

{{problem}}

## Cause

{{cause}}

## Fix applied in the patched build

{{fix}}

## Prompt

Run this in the checkout of {{checkout}}:

> {{task}}
>
> Changes go into this patch's branch, never into the integration branch,
> which is regenerated on every build. Commit the fix on {{checkout}} and
> push it so the PR picks it up.
