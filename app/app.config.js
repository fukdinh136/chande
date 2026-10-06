module.exports = ({config}) => {
  const variant=process.env.APP_VARIANT ?? 'combined';
  if(!['customer','driver','combined'].includes(variant))throw Error('APP_VARIANT must be customer, driver or combined');
  const localDemo=process.env.EXPO_PUBLIC_LOCAL_DEMO==='true';
  return {...config,name:variant==='combined'?'Velox Demo':`Velox ${variant==='customer'?'Customer':'Driver'}`,
    slug:`velox-${variant}`,scheme:`velox-${variant}`,
    android:{...config.android,package:`com.chande.${variant}`},
    extra:{...config.extra,appRole:variant},
    plugins:[...(config.plugins??[]).filter(p=>(typeof p==='string'?p:p[0])!=='expo-build-properties'),['expo-build-properties',{android:{usesCleartextTraffic:localDemo}}]],
  };
};
