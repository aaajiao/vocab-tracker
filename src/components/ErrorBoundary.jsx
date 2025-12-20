import { Component } from 'react';

class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('Error caught by boundary:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-8 max-w-md text-center shadow-lg">
                        <div className="text-6xl mb-4">😵</div>
                        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">
                            出错了
                        </h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                            应用遇到了一个问题。请刷新页面重试。
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-4 py-2 bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg font-medium hover:bg-slate-700 dark:hover:bg-slate-200 transition-colors"
                        >
                            刷新页面
                        </button>
                        {this.state.error && (
                            <details className="mt-4 text-left">
                                <summary className="text-xs text-slate-400 cursor-pointer">
                                    错误详情
                                </summary>
                                <pre className="mt-2 p-2 bg-slate-100 dark:bg-slate-900 rounded text-xs text-red-600 dark:text-red-400 overflow-auto">
                                    {this.state.error.toString()}
                                </pre>
                            </details>
                        )}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
