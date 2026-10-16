import { businessTools } from './tools/business'
import { catalogTool } from './tools/catalog'
import { codeTools } from './tools/code'
import { commsTools } from './tools/comms'
import { companyTools } from './tools/company'
import { dateTimeExtraTools } from './tools/datetime-extra'
import { educationTools } from './tools/education'
import { erpMoreTools } from './tools/erp-more'
import { everydayTools } from './tools/everyday'
import { fileOutTools } from './tools/files-out'
import { hrTools } from './tools/hr'
import { mathAdvancedTools } from './tools/math-advanced'
import { mathMoreTools } from './tools/math-more'
import { textMoreTools } from './tools/text-more'
import { datasetTools } from './tools/datasets'
import { erpTools } from './tools/erp'
import { financeTools } from './tools/finance'
import { financeExtraTools } from './tools/finance-extra'
import { itTools } from './tools/it'
import { knowledgeTools } from './tools/knowledge'
import { memoryTools } from './tools/memory'
import { metaTools } from './tools/meta'
import { researchTools } from './tools/research'
import { visionTools } from './tools/vision'
import { webHttpTools } from './tools/web-http'
import { workflowTools } from './tools/workflow'
import { logisticsTools } from './tools/logistics'
import { marketingTools } from './tools/marketing'
import { projectTools } from './tools/project'
import { networkingTools } from './tools/networking'
import { posTools } from './tools/pos'
import { textTools } from './tools/text'
import { textExtraTools } from './tools/text-extra'
import { timeColorTools } from './tools/time-color'
import { utilityTools } from './tools/utility'
import { webTools } from './tools/web'
import { webExtraTools } from './tools/web-extra'
import { workspaceTools } from './tools/workspace'
import type { Tool, ToolContext } from './tool-types'

export type { Learnable, Tool, ToolCall, ToolContext, ToolParam } from './tool-types'
export { calculate } from './tools/utility'

/**
 * The full registry. To add a tool, add it to one of the files in ./tools
 * (or create a new group and list it here). The router decides which few
 * tools are shown to the model for each question, so this list can grow.
 */
export function createTools(ctx: ToolContext): Tool[] {
  const all: Tool[] = [
    ...utilityTools,
    ...timeColorTools,
    ...dateTimeExtraTools,
    ...mathMoreTools,
    ...mathAdvancedTools,
    ...everydayTools,
    ...educationTools,
    ...textTools,
    ...textExtraTools,
    ...textMoreTools,
    ...knowledgeTools(ctx),
    ...researchTools(ctx),
    ...memoryTools,
    ...companyTools,
    ...datasetTools,
    ...erpTools,
    ...erpMoreTools,
    ...hrTools,
    ...posTools,
    ...businessTools,
    ...financeTools,
    ...financeExtraTools,
    ...marketingTools,
    ...projectTools,
    ...logisticsTools,
    ...itTools,
    ...networkingTools,
    ...workspaceTools,
    ...workflowTools,
    ...commsTools,
    ...fileOutTools,
    ...codeTools,
    ...visionTools,
    ...webTools,
    ...webExtraTools,
    ...webHttpTools,
  ]
  all.push(...metaTools(() => all)) // these inspect and run the other tools, so they see the whole list
  all.push(catalogTool(() => all)) // lists the assistant's own tools, so it must see the whole list
  return all
}
