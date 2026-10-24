/**
 * The inset header's page title and its optional right-aligned status
 * (MASTER §2.1). Pages set them with `useShellHeader`. The setter and the
 * value are separate contexts, so a page that sets the header never re-renders
 * because the header changed.
 */
import {
    createContext,
    useContext,
    useEffect,
    useState,
    type Dispatch,
    type ReactNode,
    type SetStateAction,
} from "react";

type HeaderContent = { title: string; status: ReactNode };

const HeaderValueContext = createContext<HeaderContent>({
    title: "",
    status: null,
});
const HeaderSetterContext = createContext<Dispatch<
    SetStateAction<HeaderContent>
> | null>(null);

export function ShellHeaderProvider({ children }: { children: ReactNode }) {
    const [content, setContent] = useState<HeaderContent>({
        title: "",
        status: null,
    });
    return (
        <HeaderSetterContext.Provider value={setContent}>
            <HeaderValueContext.Provider value={content}>
                {children}
            </HeaderValueContext.Provider>
        </HeaderSetterContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useShellHeaderValue(): HeaderContent {
    return useContext(HeaderValueContext);
}

/** Sets the header's title (and status) while the calling page is shown; also the document title. */
// eslint-disable-next-line react-refresh/only-export-components
export function useShellHeader(title: string, status: ReactNode = null): void {
    const set = useContext(HeaderSetterContext);
    useEffect(() => {
        set?.({ title, status });
    }, [set, title, status]);
    useEffect(() => {
        document.title = `${title} · POS`;
    }, [title]);
}
