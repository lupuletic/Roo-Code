import React from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { BarChart3 } from "lucide-react"
import { Tab, TabContent, TabHeader } from "../common/Tab"
import CodeMetricsPanel from "./CodeMetricsPanel"

type MetricsViewProps = {
	onDone: () => void
}

const MetricsView: React.FC<MetricsViewProps> = ({ onDone }) => {
	const { t } = useAppTranslation()

	return (
		<Tab>
			<TabHeader className="flex justify-between items-center gap-2">
				<div className="flex items-center gap-2">
					<BarChart3 className="w-5 h-5" />
					<h3 className="text-vscode-foreground m-0">{t("metrics:title")}</h3>
				</div>
				<div className="flex gap-2">
					<button className="vscode-button" title={t("common:done")} onClick={onDone}>
						{t("common:done")}
					</button>
				</div>
			</TabHeader>

			<TabContent className="p-4">
				<CodeMetricsPanel />
			</TabContent>
		</Tab>
	)
}

export default MetricsView
