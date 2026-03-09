import crypto from 'node:crypto';

import { env } from '@documenso/lib/utils/env';

export type Sign8CSCConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  credentialId?: string;
  pin?: string;
};

export type Sign8AuthResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
};

export type Sign8CredentialInfo = {
  credentialID: string;
  description?: string;
  key: {
    status: string;
    algo: string[];
    len: number;
  };
  cert: {
    status: string;
    certificates: string[];
    issuerDN?: string;
    serialNumber?: string;
    subjectDN?: string;
    validFrom?: string;
    validTo?: string;
  };
  authMode: string;
  SCAL: string;
  PIN?: {
    presence: string;
    format?: string;
    label?: string;
  };
  OTP?: {
    presence: string;
    type?: string;
    format?: string;
    label?: string;
    description?: string;
    ID?: string;
    provider?: string;
  };
  multisign?: number;
  lang?: string;
};

export type Sign8CredentialsListResponse = {
  credentialIDs: string[];
  credentialInfos?: Sign8CredentialInfo[];
};

export type Sign8CredentialInfoResponse = Sign8CredentialInfo;

export type Sign8AuthorizeResponse = {
  SAD: string;
  expiresIn?: number;
};

export type Sign8SignHashResponse = {
  signatures: string[];
  signatureObject?: string;
};

export type Sign8ErrorResponse = {
  error: string;
  error_description?: string;
};

export class Sign8CSCClient {
  private config: Sign8CSCConfig;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(config?: Partial<Sign8CSCConfig>) {
    this.config = {
      baseUrl: config?.baseUrl || env('NEXT_PRIVATE_SIGNING_SIGN8_BASE_URL') || '',
      clientId: config?.clientId || env('NEXT_PRIVATE_SIGNING_SIGN8_CLIENT_ID') || '',
      clientSecret: config?.clientSecret || env('NEXT_PRIVATE_SIGNING_SIGN8_CLIENT_SECRET') || '',
      credentialId: config?.credentialId || env('NEXT_PRIVATE_SIGNING_SIGN8_CREDENTIAL_ID'),
      pin: config?.pin || env('NEXT_PRIVATE_SIGNING_SIGN8_PIN'),
    };

    this.validateConfig();
  }

  private validateConfig(): void {
    if (!this.config.baseUrl) {
      throw new Error('Sign8 CSC API: baseUrl is required');
    }
    if (!this.config.clientId) {
      throw new Error('Sign8 CSC API: clientId is required');
    }
    if (!this.config.clientSecret) {
      throw new Error('Sign8 CSC API: clientSecret is required');
    }
  }

  private async request<T>(
    endpoint: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      requiresAuth?: boolean;
    } = {},
  ): Promise<T> {
    const { method = 'POST', body, requiresAuth = true } = options;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (requiresAuth) {
      const token = await this.getAccessToken();
      headers['Authorization'] = `Bearer ${token}`;
    }

    const url = `${this.config.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as Sign8ErrorResponse;
      throw new Error(
        `Sign8 CSC API error: ${errorData.error || response.statusText} - ${errorData.error_description || ''}`,
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Authenticate with Sign8 CSC API using OAuth2 client credentials
   */
  async authenticate(): Promise<Sign8AuthResponse> {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', this.config.clientId);
    params.append('client_secret', this.config.clientSecret);

    const response = await fetch(`${this.config.baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as Sign8ErrorResponse;
      throw new Error(
        `Sign8 authentication failed: ${errorData.error || response.statusText} - ${errorData.error_description || ''}`,
      );
    }

    const authData = (await response.json()) as Sign8AuthResponse;

    this.accessToken = authData.access_token;
    this.tokenExpiresAt = Date.now() + authData.expires_in * 1000 - 60000; // Refresh 1 minute before expiry

    return authData;
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  private async getAccessToken(): Promise<string> {
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt) {
      await this.authenticate();
    }

    if (!this.accessToken) {
      throw new Error('Failed to obtain Sign8 access token');
    }

    return this.accessToken;
  }

  /**
   * List available signing credentials
   * CSC API: /credentials/list
   */
  async listCredentials(options?: {
    credentialInfo?: boolean;
    certificates?: string;
    certInfo?: boolean;
    authInfo?: boolean;
  }): Promise<Sign8CredentialsListResponse> {
    return this.request<Sign8CredentialsListResponse>('/csc/v2/credentials/list', {
      body: {
        credentialInfo: options?.credentialInfo ?? true,
        certificates: options?.certificates ?? 'chain',
        certInfo: options?.certInfo ?? true,
        authInfo: options?.authInfo ?? true,
      },
    });
  }

  /**
   * Get information about a specific credential
   * CSC API: /credentials/info
   */
  async getCredentialInfo(
    credentialID: string,
    options?: {
      certificates?: string;
      certInfo?: boolean;
      authInfo?: boolean;
    },
  ): Promise<Sign8CredentialInfoResponse> {
    return this.request<Sign8CredentialInfoResponse>('/csc/v2/credentials/info', {
      body: {
        credentialID,
        certificates: options?.certificates ?? 'chain',
        certInfo: options?.certInfo ?? true,
        authInfo: options?.authInfo ?? true,
      },
    });
  }

  /**
   * Authorize a credential for signing
   * CSC API: /credentials/authorize
   */
  async authorizeCredential(options: {
    credentialID: string;
    numSignatures?: number;
    hash?: string[];
    PIN?: string;
    OTP?: string;
    description?: string;
    clientData?: string;
  }): Promise<Sign8AuthorizeResponse> {
    const body: Record<string, unknown> = {
      credentialID: options.credentialID,
      numSignatures: options.numSignatures ?? 1,
    };

    if (options.hash) {
      body.hash = options.hash;
    }

    if (options.PIN) {
      body.PIN = options.PIN;
    }

    if (options.OTP) {
      body.OTP = options.OTP;
    }

    if (options.description) {
      body.description = options.description;
    }

    if (options.clientData) {
      body.clientData = options.clientData;
    }

    return this.request<Sign8AuthorizeResponse>('/csc/v2/credentials/authorize', {
      body,
    });
  }

  /**
   * Sign one or more hash values
   * CSC API: /signatures/signHash
   */
  async signHash(options: {
    credentialID: string;
    SAD: string;
    hashes: string[];
    hashAlgorithmOID: string;
    signAlgo?: string;
    signAlgoParams?: string;
    operationMode?: string;
    clientData?: string;
  }): Promise<Sign8SignHashResponse> {
    const body: Record<string, unknown> = {
      credentialID: options.credentialID,
      SAD: options.SAD,
      hashes: options.hashes,
      hashAlgorithmOID: options.hashAlgorithmOID,
      signAlgo: options.signAlgo || '1.2.840.113549.1.1.1', // RSA PKCS#1 v1.5
      operationMode: options.operationMode || 'S', // Synchronous by default
    };

    if (options.signAlgoParams) {
      body.signAlgoParams = options.signAlgoParams;
    }

    if (options.clientData) {
      body.clientData = options.clientData;
    }

    return this.request<Sign8SignHashResponse>('/csc/v2/signatures/signHash', {
      body,
    });
  }

  /**
   * Get the configured credential ID or the first available one
   */
  async getCredentialId(): Promise<string> {
    if (this.config.credentialId) {
      return this.config.credentialId;
    }

    const credentials = await this.listCredentials();

    if (!credentials.credentialIDs || credentials.credentialIDs.length === 0) {
      throw new Error('No signing credentials available in Sign8 account');
    }

    return credentials.credentialIDs[0];
  }

  /**
   * Get the signing certificate for a credential
   */
  async getSigningCertificate(credentialID: string): Promise<Buffer> {
    const credentialInfo = await this.getCredentialInfo(credentialID, {
      certificates: 'chain',
    });

    if (!credentialInfo.cert?.certificates || credentialInfo.cert.certificates.length === 0) {
      throw new Error('No certificate available for credential');
    }

    // The first certificate in the chain is the signing certificate
    const certBase64 = credentialInfo.cert.certificates[0];
    return Buffer.from(certBase64, 'base64');
  }

  /**
   * Compute SHA-256 hash of content
   */
  computeHash(content: Buffer, algorithm: string = 'SHA-256'): string {
    const normalizedAlgo = algorithm.replace('-', '').toLowerCase();
    const hash = crypto.createHash(normalizedAlgo);
    hash.update(content);
    return hash.digest('base64');
  }

  /**
   * Complete signing flow: authorize and sign hash
   */
  async sign(options: {
    content: Buffer;
    credentialID?: string;
    hashAlgo?: string;
    PIN?: string;
  }): Promise<Buffer> {
    const credentialID = options.credentialID || (await this.getCredentialId());
    const hashAlgo = options.hashAlgo || '2.16.840.1.101.3.4.2.1'; // OID for SHA-256
    const hashAlgoName = 'SHA-256';

    // Compute hash of the content
    const hashBase64 = this.computeHash(options.content, hashAlgoName);

    // Authorize the credential for signing
    const authResponse = await this.authorizeCredential({
      credentialID,
      numSignatures: 1,
      hash: [hashBase64],
      PIN: options.PIN || this.config.pin,
    });

    // Sign the hash
    const signResponse = await this.signHash({
      credentialID,
      SAD: authResponse.SAD,
      hashes: [hashBase64],
      hashAlgorithmOID: hashAlgo,
    });

    if (!signResponse.signatures || signResponse.signatures.length === 0) {
      throw new Error('No signature returned from Sign8');
    }

    // Return the signature as a Buffer
    return Buffer.from(signResponse.signatures[0], 'base64');
  }
}

/**
 * Create a Sign8 CSC client instance with configuration from environment
 */
export const createSign8Client = (config?: Partial<Sign8CSCConfig>): Sign8CSCClient => {
  return new Sign8CSCClient(config);
};
