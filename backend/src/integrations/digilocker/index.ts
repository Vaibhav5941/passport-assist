// The only place that names a concrete provider. Swap the adapter here.
import { MockDigiLockerAdapter, MockProviderControl } from './mockAdapter.js';
import type { IDigiLockerAdapter } from './types.js';

export const mockProvider = new MockProviderControl();
export const digiLockerFor = (userId: string): IDigiLockerAdapter => new MockDigiLockerAdapter(mockProvider, userId);
