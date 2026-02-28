import * as grpc from '@grpc/grpc-js';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { connect, hash, signers } from '@hyperledger/fabric-gateway';
import type { Contract, Gateway } from '@hyperledger/fabric-gateway';

export interface BlockchainClientConfig {
  peerEndpoint: string;
  peerHostAlias: string;
  tlsCertPath: string;
  certPath: string;
  keyPath: string;
  mspId: string;
  channelName: string;
  chaincodeName: string;
}

export interface IBlockchainClient {
  appendEvent(eventJson: string): Promise<string>;
  getEvent(txId: string): Promise<string>;
  close(): void;
}

/**
 * Fabric Gateway client for append-only audit log chaincode.
 * Connects to a Hyperledger Fabric peer and submits audit events.
 */
export class FabricBlockchainClient implements IBlockchainClient {
  private gateway: Gateway;
  private contract: Contract;
  private grpcClient: grpc.Client;

  constructor(config: BlockchainClientConfig) {
    this.grpcClient = this.createGrpcClient(config);
    this.gateway = this.createGateway(config);
    this.contract = this.gateway.getNetwork(config.channelName).getContract(config.chaincodeName);
  }

  private createGrpcClient(config: BlockchainClientConfig): grpc.Client {
    const tlsRootCert = fs.readFileSync(config.tlsCertPath) as Buffer;
    const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
    return new grpc.Client(config.peerEndpoint, tlsCredentials, {
      'grpc.ssl_target_name_override': config.peerHostAlias,
    });
  }

  private createGateway(config: BlockchainClientConfig): Gateway {
    const certPem = fs.readFileSync(config.certPath);
    const keyPem = fs.readFileSync(config.keyPath);
    const privateKey = crypto.createPrivateKey(keyPem);

    const identity = { mspId: config.mspId, credentials: certPem };
    const signer = signers.newPrivateKeySigner(privateKey);

    return connect({
      client: this.grpcClient,
      identity,
      signer,
      hash: hash.sha256,
      evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
      endorseOptions: () => ({ deadline: Date.now() + 15000 }),
      submitOptions: () => ({ deadline: Date.now() + 5000 }),
      commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
    });
  }

  async appendEvent(eventJson: string): Promise<string> {
    const resultBytes = await this.contract.submitTransaction('Append', eventJson);
    return new TextDecoder().decode(resultBytes);
  }

  async getEvent(txId: string): Promise<string> {
    const resultBytes = await this.contract.evaluateTransaction('Get', txId);
    return new TextDecoder().decode(resultBytes);
  }

  close(): void {
    this.gateway.close();
    this.grpcClient.close();
  }
}

/**
 * Create a Fabric blockchain client from environment configuration.
 */
export async function createFabricBlockchainClient(
  config: BlockchainClientConfig,
): Promise<FabricBlockchainClient> {
  return new FabricBlockchainClient(config);
}
