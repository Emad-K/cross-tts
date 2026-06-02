import { ReaderApp } from "@/features/reader";

export default function App() {
	return (
		<div className="dark flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-background text-foreground">
			<ReaderApp />
		</div>
	);
}
