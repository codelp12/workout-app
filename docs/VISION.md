# Vision

## Problem

Fitness apps are specialized and subscription-priced. A runner who also lifts ends up paying for several apps
(~$10/month each, often ~$50/month total), each padded with social features and engagement bloat, with data
siloed across all of them.

## Goal

A single, focused app for planning and tracking all training, built for its owner rather than for engagement metrics.
The detailed product spec and build plan is [SPEC.md](SPEC.md).

## In scope (high level)

- Planning and logging lifting, running and climbing as one coherent week (6 lift, 3 run, 2 climb sessions).
- Coaching targets that explain themselves, adapting to performance, effort and readiness.
- History and progress over time.
- Data export and backups.

## Explicitly out of scope

- Social feeds, sharing-first features, leaderboards.
- Ads, upsells, paywalled features.

## Resolved questions

- Platform: an installable PWA, used on iPhone at the gym and in a laptop browser.
- Data sources: manual entry for v1; FIT/GPX/TCX file import later.
- Storage: offline-first on the device, synced to a self-hosted home server.
- Activity types for v1: lifting, running and climbing.

Remaining open questions live in [SPEC.md](SPEC.md) Section 12.
