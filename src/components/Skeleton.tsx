import { memo } from 'react';

// Base skeleton block with pulse animation
function SkeletonBox({ className }: { className: string }) {
    return (
        <div
            className={`animate-pulse bg-slate-200 dark:bg-slate-700 rounded ${className}`}
        />
    );
}

// Word card skeleton
export const WordCardSkeleton = memo(function WordCardSkeleton() {
    return (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-3">
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        <SkeletonBox className="w-20 h-5" />
                        <SkeletonBox className="w-12 h-4" />
                        <SkeletonBox className="w-10 h-4" />
                    </div>
                    <SkeletonBox className="w-3/4 h-4 mb-3" />
                    <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                        <SkeletonBox className="w-full h-4 mb-2" />
                        <SkeletonBox className="w-2/3 h-3" />
                    </div>
                </div>
            </div>
        </div>
    );
});

// Stats card skeleton
export const StatsCardSkeleton = memo(function StatsCardSkeleton() {
    return (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
            <SkeletonBox className="w-10 h-7 mb-1" />
            <SkeletonBox className="w-8 h-3" />
        </div>
    );
});

// Full page loading skeleton
export const PageSkeleton = memo(function PageSkeleton() {
    return (
        <div className="max-w-xl mx-auto p-4 py-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                    <SkeletonBox className="w-10 h-10 rounded-lg" />
                    <div>
                        <SkeletonBox className="w-16 h-5 mb-1" />
                        <SkeletonBox className="w-20 h-3" />
                    </div>
                </div>
                <div className="flex gap-2">
                    <SkeletonBox className="w-8 h-8 rounded-lg" />
                    <SkeletonBox className="w-8 h-8 rounded-lg" />
                    <SkeletonBox className="w-16 h-8 rounded-lg" />
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <StatsCardSkeleton />
                <StatsCardSkeleton />
                <StatsCardSkeleton />
                <StatsCardSkeleton />
            </div>

            {/* Search */}
            <div className="flex gap-3 mb-6">
                <SkeletonBox className="flex-1 h-10 rounded-xl" />
                <SkeletonBox className="w-20 h-10 rounded-xl" />
            </div>

            {/* Tabs */}
            <SkeletonBox className="w-full h-10 rounded-xl mb-6" />

            {/* Word Cards */}
            <div className="mb-4">
                <SkeletonBox className="w-12 h-4 mb-3" />
                <WordCardSkeleton />
                <WordCardSkeleton />
            </div>
            <div>
                <SkeletonBox className="w-16 h-4 mb-3" />
                <WordCardSkeleton />
            </div>
        </div>
    );
});

export default PageSkeleton;
