import type { ModelOption } from './llm'
import { fitContext } from './ollama'
import { fittedCtx, saveFit } from './profile'

/**
 * First use of a model at a given window size: load it and check it fits in GPU memory, lowering the window if it does not
 * (a model that spills onto the CPU is several times slower). The result is remembered, so this happens once per model.
 */
export async function prepareModel(model: ModelOption, onStatus?: (status: string) => void): Promise<{ model: ModelOption; lowered: boolean }> {
  if (fittedCtx(model.id, model.profile.wantCtx) !== null) return { model, lowered: false }
  onStatus?.(`Loading ${model.id} and checking it fits in memory…`)
  try {
    const fit = await fitContext(model.id, model.profile.wantCtx)
    saveFit(model.id, model.profile.wantCtx, fit.ctx)
    return { model: { ...model, profile: { ...model.profile, numCtx: fit.ctx } }, lowered: fit.ctx < model.profile.wantCtx }
  } catch {
    return { model, lowered: false } // could not test: use the wanted size
  }
}
