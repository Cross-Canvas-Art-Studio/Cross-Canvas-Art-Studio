/**
 * Skein estimation for cross-stitch floss.
 *
 * This is an ESTIMATE, not a guarantee, and it is deliberately a separate,
 * dependency-free module so the maths can be unit-tested headlessly (see
 * tools/verify_render.js) and reused by any build.
 *
 * Model
 * -----
 *   stitchesPerSkein(count) = base * (count / referenceCount)
 *                                  * (referenceStrands / usedStrands)
 *   skeins(stitches)        = ceil( stitches * (1 + wasteFactor) / stitchesPerSkein )
 *
 * Why these terms:
 *   - Thread consumed per stitch scales as 1/fabricCount, so a 28 ct fabric
 *     covers roughly twice the stitches of a 14 ct fabric per equal length of
 *     floss. Up to a point -- very fine counts use more relative thread for
 *     railroading, which is what wasteFactor absorbs.
 *   - Stitching with more strands burns floss proportionally faster.
 *   - wasteFactor covers thread tails, the extra row used to start and stop,
 *     and frogging.
 *
 * `base` (stitches per skein at 14 ct with 2 strands) is the SINGLE calibration
 * constant. It lives in App/config.json under "skein" so it can be tuned
 * without touching code. The default of 1700 is a rule-of-thumb figure and has
 * NOT been validated against a stitched piece -- treat output accordingly.
 */
(function () {
  "use strict";

  var DEFAULTS = {
    /** Stitches one skein covers at 14 ct using 2 strands. */
    stitchesPerSkeinAt14ct: 1700,
    /** Fabric count the base figure was measured at. */
    referenceCount: 14,
    /** Strands the base figure was measured with. */
    referenceStrands: 2,
    /** Strands the user intends to stitch with. */
    usedStrands: 2,
    /** Fraction added for tails, starting/stopping and mistakes. */
    wasteFactor: 0.15,
  };

  function positive(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) && n > 0 ? n : fallback;
  }

  /** Normalise a config block (snake_case, as stored in config.json). */
  function options(raw) {
    var o = raw || {};
    var waste = parseFloat(o.waste_factor);
    return {
      stitchesPerSkeinAt14ct: positive(
        o.stitches_per_skein_at_14ct,
        DEFAULTS.stitchesPerSkeinAt14ct,
      ),
      referenceCount: positive(o.reference_count, DEFAULTS.referenceCount),
      referenceStrands: positive(
        o.reference_strands,
        DEFAULTS.referenceStrands,
      ),
      usedStrands: positive(o.used_strands, DEFAULTS.usedStrands),
      // Zero waste is a legitimate choice, so it must not fall back.
      wasteFactor: isFinite(waste) && waste >= 0 ? waste : DEFAULTS.wasteFactor,
    };
  }

  /** Stitches one skein covers on `fabricCount`, at the configured strands. */
  function stitchesPerSkein(fabricCount, raw) {
    var o = options(raw);
    var count = positive(fabricCount, o.referenceCount);
    return (
      (o.stitchesPerSkeinAt14ct * (count / o.referenceCount) *
        o.referenceStrands) / o.usedStrands
    );
  }

  /** Whole skeins needed for `stitches` on `fabricCount`. 0 when no stitches. */
  function skeinsFor(stitches, fabricCount, raw) {
    var o = options(raw);
    var total = parseFloat(stitches);
    if (!isFinite(total) || total <= 0) return 0;
    var per = stitchesPerSkein(fabricCount, raw);
    if (!(per > 0)) return 0;
    return Math.ceil((total * (1 + o.wasteFactor)) / per);
  }

  window.StitchSkein = {
    DEFAULTS: DEFAULTS,
    options: options,
    stitchesPerSkein: stitchesPerSkein,
    skeinsFor: skeinsFor,
  };
})();
