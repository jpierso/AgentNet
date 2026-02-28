package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// AuditLogChaincode provides append-only audit log functions
type AuditLogChaincode struct {
	contractapi.Contract
}

// Append stores an audit event in the ledger. Returns the transaction ID for verification.
// No update or delete functions exist — append-only by design.
func (a *AuditLogChaincode) Append(ctx contractapi.TransactionContextInterface, eventJSON string) (string, error) {
	if eventJSON == "" {
		return "", fmt.Errorf("event JSON cannot be empty")
	}

	// Validate JSON
	var js map[string]interface{}
	if err := json.Unmarshal([]byte(eventJSON), &js); err != nil {
		return "", fmt.Errorf("invalid event JSON: %w", err)
	}

	txID := ctx.GetStub().GetTxID()
	if err := ctx.GetStub().PutState(txID, []byte(eventJSON)); err != nil {
		return "", fmt.Errorf("failed to put audit event: %w", err)
	}

	return txID, nil
}

// Get returns the audit event for a given transaction ID (for verification).
func (a *AuditLogChaincode) Get(ctx contractapi.TransactionContextInterface, txID string) (string, error) {
	eventJSON, err := ctx.GetStub().GetState(txID)
	if err != nil {
		return "", fmt.Errorf("failed to read from world state: %w", err)
	}
	if eventJSON == nil {
		return "", fmt.Errorf("audit event %s does not exist", txID)
	}
	return string(eventJSON), nil
}

func main() {
	chaincode, err := contractapi.NewChaincode(&AuditLogChaincode{})
	if err != nil {
		panic(err)
	}
	if err := chaincode.Start(); err != nil {
		panic(err)
	}
}
