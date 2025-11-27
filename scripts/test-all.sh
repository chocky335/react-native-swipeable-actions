#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# E2E test runner selection (appium or maestro)
# Usage: E2E_RUNNER=maestro ./scripts/test-all.sh
# Usage: SKIP_E2E=1 ./scripts/test-all.sh (skip E2E tests)
E2E_RUNNER="${E2E_RUNNER:-appium}"
SKIP_E2E="${SKIP_E2E:-0}"

echo "=== React Native Swipeable Actions - Full Test Suite ==="
echo "E2E Runner: $E2E_RUNNER"
if [ "$SKIP_E2E" = "1" ]; then
    echo "E2E Tests: SKIPPED"
fi
echo ""

# Track overall status
OVERALL_STATUS=0

# 1. TypeScript type checking
echo -e "${YELLOW}[1/6] TypeScript type checking...${NC}"
if npm run typecheck; then
    echo -e "${GREEN}  ✓ TypeScript checks passed${NC}"
else
    echo -e "${RED}  ✗ TypeScript checks failed${NC}"
    OVERALL_STATUS=1
fi
echo ""

# 2. ESLint
echo -e "${YELLOW}[2/6] ESLint...${NC}"
if npm run lint; then
    echo -e "${GREEN}  ✓ ESLint passed${NC}"
else
    echo -e "${RED}  ✗ ESLint failed${NC}"
    OVERALL_STATUS=1
fi
echo ""

# 3. Jest unit tests
echo -e "${YELLOW}[3/6] Jest unit tests...${NC}"
if npm test; then
    echo -e "${GREEN}  ✓ Jest tests passed${NC}"
else
    echo -e "${RED}  ✗ Jest tests failed${NC}"
    OVERALL_STATUS=1
fi
echo ""

# 4. iOS Swift tests (macOS only)
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo -e "${YELLOW}[4/6] iOS Swift tests...${NC}"
    if npm run test:ios; then
        echo -e "${GREEN}  ✓ iOS Swift tests passed${NC}"
    else
        echo -e "${RED}  ✗ iOS Swift tests failed${NC}"
        OVERALL_STATUS=1
    fi
else
    echo -e "${YELLOW}[4/6] iOS Swift tests...${NC}"
    echo -e "${YELLOW}  ⊘ Skipped (not macOS)${NC}"
fi
echo ""

# 5. Android Gradle tests
echo -e "${YELLOW}[5/6] Android Gradle tests...${NC}"
if npm run test:android; then
    echo -e "${GREEN}  ✓ Android tests passed${NC}"
else
    echo -e "${RED}  ✗ Android tests failed${NC}"
    OVERALL_STATUS=1
fi
echo ""

# 6. E2E tests
echo -e "${YELLOW}[6/6] E2E tests ($E2E_RUNNER)...${NC}"

if [ "$SKIP_E2E" = "1" ]; then
    echo -e "${YELLOW}  ⊘ Skipped (SKIP_E2E=1)${NC}"
elif [ "$E2E_RUNNER" = "maestro" ]; then
    # Maestro E2E tests (core suite only, <2 min)
    cd example

    TESTS=(
        "main-tests.yaml"
    )

    E2E_FAILED=0
    E2E_PASSED=0

    for test in "${TESTS[@]}"; do
        echo -n "  Running $test... "
        if ~/.maestro/bin/maestro test ".maestro/$test" > /dev/null 2>&1; then
            echo -e "${GREEN}PASSED${NC}"
            ((E2E_PASSED++))
        else
            echo -e "${RED}FAILED${NC}"
            ((E2E_FAILED++))
        fi
    done

    cd ..

    echo ""
    echo "  E2E Results: $E2E_PASSED passed, $E2E_FAILED failed"

    if [ $E2E_FAILED -gt 0 ]; then
        echo -e "${RED}  ✗ E2E tests failed${NC}"
        OVERALL_STATUS=1
    else
        echo -e "${GREEN}  ✓ E2E tests passed${NC}"
    fi
else
    # Appium/WebdriverIO E2E tests (default)
    cd e2e

    if npm run test; then
        echo -e "${GREEN}  ✓ E2E tests passed${NC}"
    else
        echo -e "${RED}  ✗ E2E tests failed${NC}"
        OVERALL_STATUS=1
    fi

    cd ..
fi

echo ""
echo "=========================================="

if [ $OVERALL_STATUS -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi
