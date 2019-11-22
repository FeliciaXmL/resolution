import { invert } from './utils';
import { default as ensInterface } from './ens/contract/ens';
import { default as resolverInterface } from './ens/contract/resolver';
import { hash } from 'eth-ens-namehash';
import { formatsByCoinType } from '@ensdomains/address-encoder';
import {
  SourceDefinition,
  NamicornResolution,
  NullAddress,
  Bip44Constants,
  EthCoinIndex,
  NullAddressExtended,
} from './types';
import NamingService from './namingService';
import { ResolutionError, ResolutionErrorCode } from './index';
import Contract from './ens/contract/contract';

const DefaultUrl = 'https://mainnet.infura.io';
const NetworkIdMap = {
  1: 'mainnet',
  3: 'ropsten',
  4: 'kovan',
  42: 'rinkeby',
  5: 'goerli',
};
const NetworkNameMap = invert(NetworkIdMap);

const RegistryMap = {
  mainnet: '0x314159265dd8dbb310642f98f50c066173c1259b',
  ropsten: '0x112234455c3a32fd11230c42e7bccd4a84e02010',
};

/**
 * Class to support connection with Etherium naming service
 * @param network - network string such as
 * - mainnet
 * - ropsten
 * @param url - main api url such as
 * - https://mainnet.infura.io
 * @param registryAddress - address for a registry contract
 */
export default class Ens extends NamingService {
  readonly network: string;
  readonly url: string;
  readonly registryAddress?: string;
  private ensContract: Contract;
  /**
   * Source object describing the network naming service operates on
   * @param source - if specified as a string will be used as main url, if omited then defaults are used
   * @throws ConfigurationError - when either network or url is setup incorrectly
   */
  constructor(source: string | boolean | SourceDefinition = true) {
    super();
    source = this.normalizeSource(source);
    this.network = <string>source.network;
    this.url = source.url;
    if (!this.network) {
      throw new Error('Unspecified network in Namicorn ENS configuration');
    }
    if (!this.url) {
      throw new Error('Unspecified url in Namicorn ENS configuration');
    }
    this.registryAddress = source.registry
      ? source.registry
      : RegistryMap[this.network];
    if (this.registryAddress) {
      this.ensContract = new Contract(this.url, ensInterface, this.registryAddress);
    }
  }

  /**
   * Checks if the domain is in valid format
   * @param domain - domain name to be checked
   */
  isSupportedDomain(domain: string): boolean {
    return (
      domain.indexOf('.') > 0 && /^.{1,}\.(eth|luxe|xyz|test)$/.test(domain)
    );
  }

  /**
   * Checks if the current network is supported
   */
  isSupportedNetwork(): boolean {
    return this.registryAddress != null;
  }

  /** @internal */
  record(domain: string, key: string): Promise<string> {
    throw new Error('Method not implemented.');
  }

  /**
   * Reverse the ens address to a ens registered domain name
   * @async
   * @param address - address you wish to reverse
   * @param currencyTicker - currency ticker like BTC, ETH, ZIL
   * @returns Domain name attached to this address
   */
  async reverse(address: string, currencyTicker: string): Promise<string> {
    if (currencyTicker != 'ETH') {
      throw new Error(`Ens doesn't support any currency other than ETH`);
    }
    if (address.startsWith('0x')) {
      address = address.substr(2);
    }
    const reverseAddress = address + '.addr.reverse';
    const nodeHash = hash(reverseAddress);
    const resolverAddress = await this.getResolver(nodeHash);
    if (resolverAddress == NullAddress) {
      return null;
    }
    const resolverContract = new Contract(this.url,
      resolverInterface(resolverAddress, EthCoinIndex),
      resolverAddress,
    );

    return await this.resolverCallToName(resolverContract, nodeHash);
  }

  /**
   * Resolves domain to a specific cryptoAddress
   * @param domain - domain name to be resolved
   * @param currencyTicker - specific currency ticker such as
   *  - ZIL
   *  - BTC
   *  - ETH
   * @returns A promise that resolves in a string
   * @throws ResolutionError
   */
  async address(domain: string, currencyTicker: string): Promise<string> {
    const nodeHash = this.namehash(domain);
    const ownerPromise = this.owner(domain);
    const resolver = await this.getResolver(nodeHash);
    if (!resolver || resolver === NullAddress || resolver === NullAddressExtended) {
      const owner = await ownerPromise;
      if (!owner || owner === NullAddress || owner === NullAddressExtended)
        throw new ResolutionError(ResolutionErrorCode.UnregisteredDomain, { domain });
      throw new ResolutionError(ResolutionErrorCode.UnspecifiedResolver, { domain });
    }
    const coinType = this.getCoinType(currencyTicker);
    var addr = await this.fetchAddress(resolver, nodeHash, coinType);
    if (!addr)
      throw new ResolutionError(ResolutionErrorCode.UnspecifiedCurrency, {
        domain,
        currencyTicker,
      });
    return addr;
  }

  /**
   * Owner of the domain
   * @param domain - domain name
   * @returns An owner address of the domain
   */
  async owner(domain: string): Promise<string | null> {
    const nodeHash = this.namehash(domain);
    return (await this.getOwner(nodeHash)) || null;
  }

  /**
   * Resolves the given domain
   * @async
   * @param domain - domain name to be resolved
   * @returns A promise that resolves in an object
   */
  async resolve(domain: string): Promise<NamicornResolution | null> {
    if (!this.isSupportedDomain(domain) || !this.isSupportedNetwork()) {
      return null;
    }
    const nodeHash = this.namehash(domain);
    var [owner, ttl, resolver] = await this.getResolutionInfo(nodeHash);
    if (owner == NullAddress) owner = null;
    const address = await this.fetchAddress(resolver, nodeHash);
    return {
      addresses: {
        ETH: address,
      },
      meta: {
        owner,
        type: 'ens',
        ttl: Number(ttl),
      },
    };
  }

  /**
   * Produces ENS namehash
   * @param domain - domain to be hashed
   * @returns ENS namehash of a domain
   */
  namehash(domain: string): string {
    this.ensureSupportedDomain(domain);
    return hash(domain);
  }

  /**
   * Normalizes the source object based on type
   */
  protected normalizeSource(
    source: string | boolean | SourceDefinition,
  ): SourceDefinition {
    switch (typeof source) {
      case 'boolean': {
        return { url: DefaultUrl, network: this.networkFromUrl(DefaultUrl) };
      }
      case 'string': {
        return {
          url: source as string,
          network: this.networkFromUrl(source as string),
        };
      }
      case 'object': {
        source = { ...source };
        if (typeof source.network == 'number') {
          source.network = NetworkIdMap[source.network];
        }
        if (source.registry) {
          source.network = source.network ? source.network : 'mainnet';
          source.url = source.url
            ? source.url
            : `https://${source.network}.infura.io`;
        }
        if (
          source.network &&
          !source.url &&
          NetworkNameMap.hasOwnProperty(source.network)
        ) {
          source.url = `https://${source.network}.infura.io`;
        }
        if (source.url && !source.network) {
          source.network = this.networkFromUrl(source.url);
        }
        return source;
      }
    }
  }

  /**
   * This was done to make automated tests more configurable
   */
  private resolverCallToName(resolverContract: Contract, nodeHash) {
    return this.callMethod(resolverContract, 'name', [nodeHash] );
  }

  /**
   * This was done to make automated tests more configurable
   */
  private async getResolver(nodeHash) {
    return await this.callMethod(this.ensContract, 'resolver', [nodeHash] );
  }

  /**
   * This was done to make automated tests more configurable
   */
  private async getOwner(nodeHash) {
    return await  this.callMethod(this.ensContract, 'owner', [nodeHash] );
  }

  /**
   * This was done to make automated tests more configurable
   */
  private async getResolutionInfo(nodeHash) {
    return await Promise.all([
      this.callMethod(this.ensContract, 'owner', [nodeHash]),
      this.callMethod(this.ensContract, 'ttl', [nodeHash] ),
      this.callMethod(this.ensContract, 'resolver', [nodeHash] ),
    ]);
  }

  private getCoinType(currencyTicker: string): number {
    const constants: Bip44Constants[] = require('bip44-constants');
    const coin = constants.findIndex(
      item =>
        item[1] === currencyTicker.toUpperCase() ||
        item[2] === currencyTicker.toUpperCase(),
    );
    if (coin < 0 || !formatsByCoinType[coin])
      throw new ResolutionError(ResolutionErrorCode.UnsupportedCurrency, {
        currencyTicker,
      });
    return coin;
  }

  /**
   * @param resolver - resolver address
   * @param nodeHash - namehash of a domain name
   */
  private async fetchAddress(resolver, nodeHash, coinType?: number) {
    if (!resolver || resolver == NullAddress) {
      return null;
    }
    const resolverContract = new Contract(this.url,
      resolverInterface(resolver, coinType),
      resolver,
    );
    const addr: string =
      coinType != EthCoinIndex
      ? await this.callMethod(resolverContract, 'addr', [nodeHash, coinType] )
      : await this.callMethod(resolverContract, 'addr', [nodeHash] );
    if (!addr) return null;
    const data = Buffer.from(addr.replace('0x', ''), 'hex');
    return formatsByCoinType[coinType].encoder(data);
  }

  /**
   * Look up for network from url provided
   * @param url - main api url for blockchain
   * @returns Network such as:
   *  - mainnet
   *  - testnet
   */
  private networkFromUrl(url: string): string {
    for (const key in NetworkNameMap) {
      if (!NetworkNameMap.hasOwnProperty(key)) continue;
      if (url.indexOf(key) >= 0) return key;
    }
  }

  /**
   * Internal wrapper for ens method. Used to throw an error when ens is down
   *  @param method - method to be called
   *  @throws ResolutionError -> When blockchain is down
   */
  private async callMethod(contract: Contract, methodname: string, params: any
  ): Promise<any> {
    try {
      return await contract.fetchMethod(methodname, params);
    } catch (error) {
      const { message }: { message: string } = error;
      if (
        message.match(/Invalid JSON RPC response/) ||
        message.match(/legacy access request rate exceeded/)
      ) {
        throw new ResolutionError(ResolutionErrorCode.NamingServiceDown, {
          method: 'ENS',
        });
      }
      throw error;
    }
  }
}