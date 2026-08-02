/**
 * Browser-compatibility shims for the WebGPU backend.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * three r185 passes `swizzle: 'rgba'` (a string, per the older
 * texture-component-swizzle proposal) in every `GPUTexture.createView()`
 * descriptor. Current Chromium types that member as a `GPUTextureComponentSwizzle`
 * *dictionary* (`{ r, g, b, a }`), so the string makes every `createView()`
 * throw a `TypeError` and no frame ever renders — the viewport stays black
 * while the rest of the app works.
 *
 * `'rgba'` is the identity swizzle, so dropping it is semantically a no-op; a
 * non-identity string (nothing in this app produces one) is converted to the
 * dictionary form instead. The patch is lazy: descriptors pass through
 * untouched until the first `TypeError` proves this browser rejects string
 * swizzles, so browsers that accept three's form never pay for it.
 *
 * Remove once three ships descriptors matching the shipped Chromium IDL.
 */

type SwizzledDescriptor = { swizzle?: unknown } & Record<string, unknown>;

const IDENTITY_SWIZZLE = 'rgba';

let installed = false;
let stringSwizzleRejected = false;

function convert(descriptor: SwizzledDescriptor): SwizzledDescriptor {
  const { swizzle, ...rest } = descriptor;
  if (typeof swizzle === 'string' && swizzle !== IDENTITY_SWIZZLE && swizzle.length === 4) {
    const [r, g, b, a] = swizzle;
    return { ...rest, swizzle: { r, g, b, a } };
  }
  return rest;
}

export function installWebGpuCompat(): void {
  if (installed || typeof window === 'undefined') return;
  const proto = (window as { GPUTexture?: { prototype: { createView: (d?: unknown) => unknown } } })
    .GPUTexture?.prototype;
  if (!proto?.createView) return;
  installed = true;

  const original = proto.createView;
  proto.createView = function patchedCreateView(descriptor?: unknown) {
    const desc = descriptor as SwizzledDescriptor | undefined;
    if (desc && typeof desc.swizzle === 'string') {
      if (stringSwizzleRejected) return original.call(this, convert(desc));
      try {
        return original.call(this, desc);
      } catch (err) {
        if (!(err instanceof TypeError)) throw err;
        stringSwizzleRejected = true;
        return original.call(this, convert(desc));
      }
    }
    return original.call(this, descriptor);
  };
}
