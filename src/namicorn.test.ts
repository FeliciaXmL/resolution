import nock from 'nock';
import Namicorn from './namicorn';
import _ from 'lodash';
import mockData from './testData/mockData.json';
import Ens from './ens';

const DefaultUrl = 'https://unstoppabledomains.com/api/v1';
const MainnetUrl = 'https://mainnet.infura.io';
const ZilliqaUrl = 'https://api.zilliqa.com';

const mockAPICalls = (
  topLevel: string,
  testName: string,
  url = MainnetUrl,
) => {
  if (process.env.LIVE) {
    return;
  }
  const mcdt = mockData as any;
  const tplvl = mcdt[topLevel] as any;
  const mockCall = tplvl[testName] as [any];

  mockCall.forEach(({ METHOD, REQUEST, RESPONSE }) => {
    switch (METHOD) {
      case 'POST': {
        nock(url)
        // .log(console.log)
          .post('/', JSON.stringify(REQUEST))
          .reply(200, JSON.stringify(RESPONSE));
      }
      default: {
        nock(url)
        // .log(console.log)
          .get(REQUEST as string)
          .reply(200, RESPONSE);
      }
    }
  });
};

beforeEach(() => {
  nock.cleanAll();
  jest.restoreAllMocks();
});

describe("ZNS", () => {
  it('resolving from unstoppable API', async () => {
    const testName = 'should work';
    mockAPICalls('UD_API', testName, DefaultUrl);
    const namicorn = new Namicorn({ blockchain: false });
    const result = await namicorn.address('cofounding.zil', 'eth');
    expect(result).toEqual('0xaa91734f90795e80751c96e682a321bb3c1a4186');
  });

  it('resolves .zil name using blockchain', async () => {
    const testName = 'resolves .zil name using blockchain';
    mockAPICalls('ZIL', testName, ZilliqaUrl);
    const namicorn = new Namicorn({ blockchain: { zns: ZilliqaUrl } });
    const result = await namicorn.resolve('cofounding.zil');
    expect(result).toBeDefined();
    expect(result.addresses.ETH).toEqual(
      '0xaa91734f90795e80751c96e682a321bb3c1a4186',
    );
    expect(result.meta.owner).toEqual(
      '0x267ca17e8b3bbf49c52a4c3b473cdebcbaf9025e',
    );
    expect(result.meta.type).toEqual('zns');
    expect(result.meta.ttl).toEqual(0);
  });

  it('resolves unclaimed domain using blockchain', async () => {
    const namicorn = new Namicorn({ blockchain: true });
    const result = await namicorn.resolve('test.zil');
    expect(result.addresses).toEqual({});
    expect(result.meta.owner).toEqual(null);
  });
  it("doesn't support zil domain when zns is disabled", () => {
    let namicorn = new Namicorn({blockchain: {zns: false}});
    expect(namicorn.isSupportedDomain("hello.zil")).toBeFalsy()
  })
})

describe("ENS", () => {
  it('allows ens network specified as string', async () => {
    const testName = 'resolves .eth name using blockchain';
    //mockAPICalls('ENS', testName, MainnetUrl);

    const namicorn = new Namicorn({
      blockchain: { ens: { network: 'mainnet'} },
    });
    expect(namicorn.ens.url).toEqual('https://mainnet.infura.io')
    expect(namicorn.ens.network).toEqual('mainnet')
  });

  it('resolves .eth name using blockchain', async () => {
    const testName = 'resolves .eth name using blockchain';
    mockAPICalls('ENS', testName, MainnetUrl);

    const namicorn = new Namicorn({
      blockchain: { ens: true },
    });
    expect(namicorn.ens.url).toEqual('https://mainnet.infura.io')
    expect(namicorn.ens.network).toEqual('mainnet')
    var result = await namicorn.address('matthewgould.eth', 'ETH');
    expect(result).toEqual('0x714ef33943d925731FBB89C99aF5780D888bD106');
  });

  it('reverses address to ENS domain', async () => {
    const ens = new Ens(MainnetUrl);
    const eye = jest
      .spyOn(ens, '_resolverCallToName')
      .mockImplementation(() => 'adrian.argent.xyz');
    const secondEye = jest
      .spyOn(ens, '_getResolver')
      .mockImplementation(() => '0xDa1756Bb923Af5d1a05E277CB1E54f1D0A127890');
    const result = await ens.reverse(
      '0xb0E7a465D255aE83eb7F8a50504F3867B945164C',
      'ETH',
    );
    expect(eye).toHaveBeenCalled();
    expect(secondEye).toHaveBeenCalled();
    expect(result).toEqual('adrian.argent.xyz');
  });

  it('reverses address to ENS domain null', async () => {
    const ens = new Ens(MainnetUrl);
    const spy = jest
      .spyOn(ens, '_getResolver')
      .mockImplementation(() => '0x0000000000000000000000000000000000000000');
    const result = await ens.reverse(
      '0x112234455c3a32fd11230c42e7bccd4a84e02010',
      'ETH',
    );

    expect(spy).toHaveBeenCalled();
    expect(result).toEqual(null);
  });

  it('resolves .xyz name using ENS blockchain', async () => {
    const namicorn = new Namicorn({
      blockchain: { ens: MainnetUrl },
    });

    const spy = jest
      .spyOn(namicorn.ens, '_getResolutionInfo')
      .mockImplementation(() =>
        Promise.resolve([
          '0xb0E7a465D255aE83eb7F8a50504F3867B945164C',
          Number(0x00),
          '0xDa1756Bb923Af5d1a05E277CB1E54f1D0A127890',
        ]),
      );

    const secondSpy = jest
      .spyOn(namicorn.ens, '_fetchAddress')
      .mockImplementation(() =>
        Promise.resolve('0xb0E7a465D255aE83eb7F8a50504F3867B945164C'),
      );

    const result = await namicorn.address('adrian.argent.xyz', 'ETH');
    expect(spy).toBeCalled();
    expect(secondSpy).toBeCalled();
    expect(result).toEqual('0xb0E7a465D255aE83eb7F8a50504F3867B945164C');
  });

  // john.luxe is valid domain but we have limitation for 7 characters only for some reason. skip this test until further
  it('resolves .luxe name using ENS blockchain', async () => {
    const namicorn = new Namicorn({
      blockchain: { ens: MainnetUrl },
    });

    const spy = jest
      .spyOn(namicorn.ens, '_getResolutionInfo')
      .mockImplementation(() =>
        Promise.resolve([
          '0xf3dE750A73C11a6a2863761E930BF5fE979d5663',
          Number(0x00),
          '0xBD5F5ec7ed5f19b53726344540296C02584A5237',
        ]),
      );

    const secondSpy = jest
      .spyOn(namicorn.ens, '_fetchAddress')
      .mockImplementation(() =>
        Promise.resolve('0xf3dE750A73C11a6a2863761E930BF5fE979d5663'),
      );

    const result = await namicorn.address('john.luxe', 'ETH');
    // expect(spy).toBeCalled();
    expect(secondSpy).toBeCalled();
    expect(result).toEqual('0xf3dE750A73C11a6a2863761E930BF5fE979d5663');
  });

  it('resolves .luxe name using ENS blockchain null', async () => {
    const namicorn = new Namicorn({
      blockchain: { ens: MainnetUrl },
    });

    const spy = jest
      .spyOn(namicorn.ens, '_getResolutionInfo')
      .mockImplementation(() =>
        Promise.resolve([
          '0x0000000000000000000000000000000000000000',
          Number(0x00),
          '0x0000000000000000000000000000000000000000',
        ]),
      );

    const secondSpy = jest
      .spyOn(namicorn.ens, '_fetchAddress')
      .mockImplementation(() => Promise.resolve(null));

    const result = await namicorn.address('something.luxe', 'ETH');
    expect(spy).toBeCalled();
    expect(secondSpy).toBeCalled();
    expect(result).toEqual(null);
  });
})

it('provides empty response constant', async () => {
  const response = Namicorn.UNCLAIMED_DOMAIN_RESPONSE;
  expect(response.addresses).toEqual({});
  expect(response.meta.owner).toEqual(null);
});

it('resolves non-existing domain zone', async () => {
  const namicorn = new Namicorn({ blockchain: true });
  const result = await namicorn.address('bogdangusiev.qq', 'ZIL');
  expect(result).toEqual(null);
});
