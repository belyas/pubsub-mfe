#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

DRY_RUN=false
SKIP_TESTS=false
SKIP_BUILD=false
PUBLISH_NPM=false
RELEASE_TYPE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --skip-tests)
      SKIP_TESTS=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --publish)
      PUBLISH_NPM=true
      shift
      ;;
    --type)
      RELEASE_TYPE="$2"
      shift 2
      ;;
    --help)
      echo "Usage: ./scripts/release.sh [options]"
      echo ""
      echo "Options:"
      echo "  --dry-run        Run without making changes"
      echo "  --skip-tests     Skip running tests"
      echo "  --skip-build     Skip building the project"
      echo "  --publish        Publish to npm after release"
      echo "  --type <type>    Release type: patch, minor, major, or auto (default: auto)"
      echo "  --help           Show this help message"
      echo ""
      echo "Examples:"
      echo "  ./scripts/release.sh --dry-run"
      echo "  ./scripts/release.sh --type minor --publish"
      echo "  ./scripts/release.sh --skip-tests --publish"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

print_step() {
  echo -e "${BLUE}==>${NC} ${GREEN}$1${NC}"
}

print_warning() {
  echo -e "${YELLOW}WARNING:${NC} $1"
}

print_error() {
  echo -e "${RED}ERROR:${NC} $1"
}

print_success() {
  echo -e "${GREEN}✓${NC} $1"
}

print_step "Validating environment..."

if [ ! -d .git ]; then
  print_error "Not a git repository"
  exit 1
fi

if [ "$DRY_RUN" = false ]; then
  if [ -n "$(git status --porcelain)" ]; then
    print_error "You have uncommitted changes. Please commit or stash them first."
    git status --short
    exit 1
  fi
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  print_warning "You are not on main branch (current: $CURRENT_BRANCH)"
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

command -v pnpm >/dev/null 2>&1 || { print_error "pnpm is required but not installed."; exit 1; }
command -v node >/dev/null 2>&1 || { print_error "node is required but not installed."; exit 1; }

print_success "Environment validated"

print_step "Running type checks..."
pnpm run typecheck
print_success "Type checks passed"

print_step "Running linter..."
if command -v pnpm run lint >/dev/null 2>&1; then
  pnpm run lint || print_warning "Linting failed (continuing anyway)"
fi

if [ "$SKIP_TESTS" = false ]; then
  print_step "Running tests..."
  if pnpm run test 2>&1 | grep -q "No test files found"; then
    print_warning "No tests found (continuing anyway)"
  elif ! pnpm run test; then
    print_error "Tests failed"
    exit 1
  else
    print_success "Tests passed"
  fi
else
  print_warning "Skipping tests (--skip-tests flag)"
fi

if [ "$SKIP_BUILD" = false ]; then
  print_step "Cleaning previous build..."
  pnpm run clean
  
  print_step "Building project..."
  pnpm run build
  print_success "Build completed"
else
  print_warning "Skipping build (--skip-build flag)"
fi

print_step "Running standard-version..."

STANDARD_VERSION_ARGS=""
if [ "$DRY_RUN" = true ]; then
  STANDARD_VERSION_ARGS="$STANDARD_VERSION_ARGS --dry-run"
fi

if [ -n "$RELEASE_TYPE" ] && [ "$RELEASE_TYPE" != "auto" ]; then
  STANDARD_VERSION_ARGS="$STANDARD_VERSION_ARGS --release-as $RELEASE_TYPE"
fi

pnpm exec standard-version $STANDARD_VERSION_ARGS

if [ "$DRY_RUN" = false ]; then
  NEW_VERSION=$(node -p "require('./package.json').version")
  print_success "Released version: v$NEW_VERSION"

  print_step "Pushing to git..."
  git push --follow-tags origin "$CURRENT_BRANCH"
  print_success "Pushed to git"
  
  if [ "$PUBLISH_NPM" = true ]; then
    print_step "Publishing to npm..."
    
    if ! pnpm whoami >/dev/null 2>&1; then
      print_error "Not logged in to npm. Run 'pnpm login' first."
      exit 1
    fi
    
    PACKAGE_NAME=$(node -p "require('./package.json').name")
    if [[ $PACKAGE_NAME == @* ]]; then
      print_warning "Publishing scoped package: $PACKAGE_NAME"
      print_warning "Make sure you have access to this scope on npm"
    fi
    
    pnpm publish --access public --no-git-checks
    print_success "Published to npm: $PACKAGE_NAME@$NEW_VERSION"
    
    REPO_URL=$(git config --get remote.origin.url | sed 's/\.git$//')
    REPO_URL=${REPO_URL/git@github.com:/https://github.com/}
    echo ""
    echo -e "${GREEN}Release completed successfully!${NC}"
    echo -e "📦 Package: ${BLUE}$PACKAGE_NAME@$NEW_VERSION${NC}"
    echo -e "🔗 GitHub: ${BLUE}$REPO_URL/releases/tag/v$NEW_VERSION${NC}"
    echo -e "🔗 npm: ${BLUE}https://www.npmjs.com/package/$PACKAGE_NAME${NC}"
  else
    echo ""
    echo -e "${GREEN}Release completed successfully!${NC}"
    echo -e "Version: ${BLUE}v$NEW_VERSION${NC}"
    echo ""
    echo -e "${YELLOW}To publish to npm, run:${NC}"
    echo -e "  pnpm publish --access public"
  fi
else
  print_warning "Dry run completed - no changes were made"
  echo ""
  echo -e "${YELLOW}To perform the actual release, run without --dry-run flag${NC}"
fi
