import { assertEquals, assertRejects } from '@std/assert';
import { PandaProvider, PandaProviderNotImplementedError } from './panda-provider.ts';

const provider = new PandaProvider();

Deno.test('PandaProvider.playerKind is "panda"', () => {
  assertEquals(provider.playerKind, 'panda');
});

Deno.test('resolve() always throws PandaProviderNotImplementedError -- production-phase work, not MVP', async () => {
  await assertRejects(() => provider.resolve('any-external-ref'), PandaProviderNotImplementedError);
});

Deno.test('resolve() never resolves to a value, even for an empty ref', async () => {
  await assertRejects(() => provider.resolve(''), PandaProviderNotImplementedError);
});
