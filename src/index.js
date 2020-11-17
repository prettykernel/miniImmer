// 写时复制，读时 merge(获取最新值)

// produce(currentState, producer: (draftState) => void): nextState
const INTERNAL_STATE_KEY = Symbol('state')

// proxy() 先为根节点创建一个 Proxy，
// 对象树上后续被访问到的所有中间节点（或新增子树的根节点）都要创建对应的 Proxy。
// 每个 Proxy 都只在监听到写操作（直接赋值、原生数据操作 API 等）时，
// 才创建拷贝值（Copy-on-write），并将之后的写操作全都代理到拷贝值上。
// 所以 Immer = 按需Proxy + 按需Copy-on-write
function proxyProp(propKey, propValue, hostDraftState) {
//console.log('[proxyProp]', propKey, propValue, hostDraftState)  // propKey 依次是 a b c
  const { draftValue } = hostDraftState
  // 第二个参数就是 onWrite
  return proxy(propValue, (value) => {
    if (draftValue.mutated === false) {
      hostDraftState.mutated = true
      // 拷贝 host 所有属性
      copyProps(draftValue, hostDraftState.originalValue)
    }
console.log(value)  // 依次是 c b a 三个对象，即 {d:0} {c:{d:0}} {b:{c:{d:0}}}
    draftValue[propKey] = value
    hostDraftState.onWrite?.(draftValue)
  })
}

// 只复制 target 上没有的属性
function copyProps(target, source) {
  if (Array.isArray(target)) {
    const len = source.length
    for (let i = 0; i < len; i++) {
      // 跳过在更深层已经被修改过的属性
      if (!(i in target)) {
        target[i] = source[i]
      }
    }
  } else {
    for (const key of Reflect.ownKeys(source)) {
      // 跳过已有属性
      if (!(key in target)) {
        const desc = Reflect.getOwnPropertyDescriptor(source, key)
        Reflect.defineProperty(target, key, desc)
      }
    }
  }
}

// 仅在第一次写时（mutated === false），才将原对象的其余属性拷贝到 draftValue 上
function copyOnWrite(draftState) {
  if (draftState.mutated === false) {
    draftState.mutated = true
    // 下一层有修改时，才往父级 draftValue 上挂
    draftState.onWrite?.(draftState.draftValue)
    // 第一次写时复制
    copyProps(draftState.draftValue, draftState.originalValue)
  }
}

function getTarget(draftState) {
  return draftState.mutated ? draftState.draftValue : draftState.originalValue
}

function proxy(originalValue, onWrite) {
console.log('[proxy]    ', originalValue)
  // 创建一份干净的 draft 值
  const draftValue = Array.isArray(originalValue) ? [] : { ...originalValue }
  const proxiedKeyMap = Object.create(null)
  // 存放代理关系及拷贝值
  const draftState = {
    mutated: false,
    originalValue,
    draftValue,
    onWrite,
  }
  // proxy() 先为根节点创建一个 Proxy，
  // 对象树上后续被访问到的所有中间节点（或新增子树的根节点）都要创建对应的 Proxy。
  const draft = new Proxy(originalValue, {
    get(target, key, receiver) {
    console.log('[get]      ', target, key)
      // 建立 proxy 到 draft 值的关联
      if (key === INTERNAL_STATE_KEY) {
        return draftState
      }
      // 优先走已创建的代理
      if (key in proxiedKeyMap) {
        return proxiedKeyMap[key]
      }

      // 代理属性访问
      if (typeof originalValue[key] === 'object' && originalValue[key] !== null) {
        // 不为基本值类型的现有属性，创建下一层代理
        proxiedKeyMap[key] = proxyProp(key, originalValue[key], draftState)
        return proxiedKeyMap[key]
      }

      // 改过，直接从 draft 取最新状态
      // 不存在的，或者值为基本值的现有属性，代理到原值
      return draftState.mutated ? draftValue[key] : Reflect.get(target, key, receiver)
    },
    set(target, key, value) {
        console.log('[set]      ', target, key)
      // 监听修改，用新值重写原值
      // 如果新值不为基本值类型，创建下一层代理
      if (typeof value === 'object') {
        proxiedKeyMap[key] = proxyProp(key, value, draftState)
      }
      // 第一次写时复制
      copyOnWrite(draftState)
      // 复制过了，直接写
      draftValue[key] = value
      return true
    },
    // 代理其它读方法
    has(_, ...args) {
      return Reflect.has(getTarget(draftState), ...args)
    },
    ownKeys(_, ...args) {
      return Reflect.ownKeys(getTarget(draftState), ...args)
    },
    getOwnPropertyDescriptor(_, ...args) {
      return Reflect.getOwnPropertyDescriptor(getTarget(draftState), ...args)
    },
    getPrototypeOf(_, ...args) {
      return Reflect.getPrototypeOf(originalValue, ...args)
    },
    // 代理其它写方法
    deleteProperty(_, ...args) {
      copyOnWrite(draftState)
      return Reflect.deleteProperty(draftValue, ...args)
    },
    defineProperty(_, ...args) {
      copyOnWrite(draftState)
      return Reflect.defineProperty(draftValue, ...args)
    },
    setPrototypeOf(_, ...args) {
      copyOnWrite(draftState)
      return Reflect.setPrototypeOf(draftValue, ...args)
    }
  })

  return draft
}

export function produce(original, producer) {
  const draftState = proxy(original)
  // 修改 draftState
  producer(draftState)
  // 取出 draftState 内部状态
  const { originalValue, draftValue, mutated } = draftState[INTERNAL_STATE_KEY]
  // console.log('-- draftState --')
  // console.log(draftState[INTERNAL_STATE_KEY])
  // 将改过的新值 patch 上去
  return mutated ? draftValue : originalValue
}
