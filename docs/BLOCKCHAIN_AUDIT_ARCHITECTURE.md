# Blockchain Audit Architecture

## Overview

AgentNet supports a blockchain-anchored audit ledger for tamper-evident, decentralized audit logs. When `AUDIT_BACKEND=blockchain`, audit events are appended to a Hyperledger Fabric consortium network and indexed locally in PostgreSQL for fast queries.

## Architecture

```
AgentNet App                    Consortium Blockchain
┌─────────────────┐            ┌──────────────────────────────┐
│ AuditService    │            │ Org A Node  Org B Node  Auditor│
│      │          │  append    │      │           │         │   │
│      ▼          │───────────▶│      └─────┬─────┴─────────┘   │
│ BlockchainAudit │            │            ▼                   │
│ Store           │            │     Immutable Ledger           │
│      │          │  index     │                                │
│      ▼          │───────────▶│                                │
│ PostgreSQL      │            └────────────────────────────────┘
│ (audit_index)   │
└─────────────────┘
```

- **Write path**: Events are submitted to the Fabric chaincode via the Gateway SDK. Consensus among consortium nodes appends to the ledger. The transaction ID is stored in the local `audit_index` table.
- **Read path**: All queries hit the local PostgreSQL `audit_index` table. The blockchain holds the canonical record for verification.

## Consortium Model

Multiple organizations run validator nodes. No single party can alter audit history. Typical setup:

- **Org A**: Your organization (AgentNet operator)
- **Org B**: Partner or internal security team
- **Org C**: External auditor

Each org runs a Fabric peer. The ordering service (Raft) achieves consensus. Chaincode enforces append-only semantics.

## Prerequisites

1. **Hyperledger Fabric network** (v2.4+) with Gateway-enabled peers
2. **Chaincode** deployed from `chaincode/auditlog/`
3. **Cryptographic materials**: TLS cert, identity cert, and private key for the client

## Chaincode

The audit log chaincode is in `chaincode/auditlog/`:

- **Append(eventJSON)** — Stores an audit event, returns transaction ID
- **Get(txID)** — Returns event by transaction ID (for verification)

Build and deploy per Fabric documentation. Example:

```bash
cd chaincode/auditlog
go mod tidy
# Package and install per your Fabric network setup
```

## Configuration

Set these environment variables when `AUDIT_BACKEND=blockchain`:

| Variable | Description |
|----------|-------------|
| `BLOCKCHAIN_PEER_ENDPOINT` | Peer gRPC endpoint (e.g., `localhost:7051`) |
| `BLOCKCHAIN_PEER_HOST_ALIAS` | TLS hostname override (e.g., `peer0.org1.example.com`) |
| `BLOCKCHAIN_TLS_CERT_PATH` | Path to peer TLS CA cert |
| `BLOCKCHAIN_CERT_PATH` | Path to client identity cert |
| `BLOCKCHAIN_KEY_PATH` | Path to client private key |
| `BLOCKCHAIN_MSP_ID` | MSP ID (e.g., `Org1MSP`) |
| `BLOCKCHAIN_CHANNEL` | Channel name (e.g., `audit-channel`) |
| `BLOCKCHAIN_CHAINCODE` | Chaincode name (e.g., `auditlog`) |

## Database Schema

The `audit_index` table stores event metadata for fast querying:

- `blockchain_tx_id` — Fabric transaction ID (canonical reference)
- `trace_id`, `agent_id`, `actor_id`, `action`, `timestamp`, etc.

Run `pnpm db:push` or migrations to create the table.

## Dual-Write and Cutover

1. **Dual-write period**: Run with `AUDIT_BACKEND=postgres` and a separate process that mirrors events to the blockchain for validation.
2. **Cutover**: Switch to `AUDIT_BACKEND=blockchain`. Historical data in `audit_events` remains for reads; new events go to blockchain + `audit_index`.

## Verification

To verify an event's integrity, fetch it from the blockchain by transaction ID and compare with the local copy. The `BlockchainAuditStore` can be extended with a `verify(txId)` method that calls the chaincode `Get` function.

## Node Deployment Runbook

1. **Stand up Fabric network** with Raft ordering
2. **Create channel** for audit events
3. **Install and approve chaincode** on all org peers
4. **Commit chaincode** to the channel
5. **Configure AgentNet** with peer endpoint and crypto paths
6. **Run `pnpm db:push`** to create `audit_index`
7. **Start AgentNet** with `AUDIT_BACKEND=blockchain`

## Retention and Pruning

Define a policy for old data:

- Archive full event payloads to cold storage (e.g., S3)
- Keep Merkle roots or hashes on-chain for long-term verification
- Prune local `audit_index` rows older than retention period (optional)
